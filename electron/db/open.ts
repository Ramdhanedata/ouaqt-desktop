import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/*
 * The one file the shop's business lives in.
 *
 * WAL mode because a power cut in the middle of a sale must not corrupt
 * anything: the write-ahead log lets SQLite recover to the last committed
 * transaction rather than to a half-written page. `synchronous = FULL` costs
 * a few milliseconds a sale and is the difference between "the till was slow
 * for a moment" and "yesterday is gone".
 *
 * Never on a network drive, never in a synced folder. Two processes writing
 * one SQLite file over SMB is the classic way to lose a database, and
 * Dropbox copying a file mid-transaction is the other.
 */

export type Migration = { name: string; sql: string };

export function openDatabase(file: string): Database.Database {
  mkdirSync(dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  /* A busy till and a sync running at once should wait, not fail. */
  db.pragma("busy_timeout = 5000");
  return db;
}

export function readMigrations(folder: string): Migration[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(folder, name), "utf8") }));
}

/*
 * Applies what has not been applied, once each, in order.
 *
 * Each file runs inside a transaction: a migration that fails halfway leaves
 * the database as it was rather than in a shape no version of the app
 * understands.
 */
export function migrate(db: Database.Database, migrations: Migration[]): string[] {
  db.exec(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at text not null
    )
  `);

  const applied = new Set(
    db.prepare("select name from schema_migrations").all().map((row) => (row as { name: string }).name)
  );

  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;

    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("insert into schema_migrations (name, applied_at) values (?, ?)").run(
        migration.name,
        new Date().toISOString()
      );
    });
    run();
    ran.push(migration.name);
  }
  return ran;
}

/** Checks the file is sound. Run after a restore and before a backup is kept. */
export function integrityIsGood(db: Database.Database): boolean {
  const result = db.pragma("integrity_check", { simple: true });
  return result === "ok";
}
