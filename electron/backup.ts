import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { getSetting, setSetting } from "./db/rows";

/*
 * Copies of the shop's database, so a dead disk or a deleted folder costs a
 * day at most, never the business.
 *
 * Three kinds. An automatic copy each day the app runs, kept on this computer
 * for the last fortnight. A copy the owner takes himself onto a USB key,
 * which is the one that survives the computer itself. And, before any
 * restore, a copy of what is about to be replaced, so a restore can always
 * be undone.
 *
 * A copy is made with SQLite's own backup, which is safe while the till is
 * selling, and every copy is opened and checked before it counts as kept.
 */

const KEEP_DAILY = 14; // not-a-rule: a fortnight of daily copies, then the oldest goes
const AUTOMATIC_EVERY_HOURS = 20; // not-a-rule: once a working day, whatever time the shop opens

function stampOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Is this file a sound OUAQT database? And whose shop is it? */
export function inspect(file: string): { ok: boolean; businessId: string | null; sales: number } {
  try {
    const copy = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const sound = copy.pragma("integrity_check", { simple: true }) === "ok";
      const tables = copy.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[];
      const names = new Set(tables.map((table) => table.name));
      if (!sound || !names.has("sales") || !names.has("settings_local")) return { ok: false, businessId: null, sales: 0 };
      const business = copy.prepare("select value from settings_local where key = 'business_id'").get() as { value: string } | undefined;
      const sales = copy.prepare("select count(*) as n from sales").get() as { n: number };
      return { ok: true, businessId: business?.value ?? null, sales: sales.n };
    } finally {
      copy.close();
    }
  } catch {
    return { ok: false, businessId: null, sales: 0 };
  }
}

export async function backupTo(database: Database.Database, file: string): Promise<boolean> {
  await database.backup(file);
  return inspect(file).ok;
}

export function backupsFolder(dataFolder: string): string {
  return join(dataFolder, "backups");
}

export type BackupInfo = { lastAutomatic: string | null; lastManual: string | null; kept: number; folder: string };

export function backupInfo(database: Database.Database, dataFolder: string): BackupInfo {
  const folder = backupsFolder(dataFolder);
  const kept = existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".db")).length : 0;
  return {
    lastAutomatic: getSetting(database, "backup_last_automatic"),
    lastManual: getSetting(database, "backup_last_manual"),
    kept,
    folder,
  };
}

/*
 * The daily copy, when the last one is old enough. Called at start and every
 * few hours after, so a shop that never closes the app still gets one a day.
 */
export async function automaticBackup(database: Database.Database, dataFolder: string, now = new Date()): Promise<string | null> {
  const last = getSetting(database, "backup_last_automatic");
  if (last && now.getTime() - new Date(last).getTime() < AUTOMATIC_EVERY_HOURS * 3_600_000) return null;

  const folder = backupsFolder(dataFolder);
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `ouaqt-${stampOf(now)}.db`);
  if (!(await backupTo(database, file))) {
    rmSync(file, { force: true });
    return null;
  }
  setSetting(database, "backup_last_automatic", now.toISOString());

  const daily = readdirSync(folder)
    .filter((name) => name.startsWith("ouaqt-") && name.endsWith(".db"))
    .sort();
  for (const old of daily.slice(0, Math.max(0, daily.length - KEEP_DAILY))) {
    rmSync(join(folder, old), { force: true });
  }
  return file;
}

export async function manualBackup(database: Database.Database, file: string, now = new Date()): Promise<boolean> {
  const ok = await backupTo(database, file);
  if (ok) setSetting(database, "backup_last_manual", now.toISOString());
  return ok;
}

export function defaultBackupName(now = new Date()): string {
  return `OUAQT-sauvegarde-${stampOf(now)}.db`;
}

export type RestoreCheck =
  | { ok: true; sales: number }
  | { ok: false; reason: "unreadable" | "other_shop" };

/*
 * A copy is only put back if it is sound and it is this shop's. Another
 * shop's database restored here would put its sales under this licence, and
 * a damaged one would replace good records with bad.
 */
export function checkRestore(file: string, businessId: string | null): RestoreCheck {
  const found = inspect(file);
  if (!found.ok) return { ok: false, reason: "unreadable" };
  if (businessId && found.businessId && found.businessId !== businessId) return { ok: false, reason: "other_shop" };
  return { ok: true, sales: found.sales };
}

/*
 * The swap itself, with the database closed. What was there is kept first,
 * beside the daily copies, so the restore can be undone.
 */
export function replaceDatabase(dataFolder: string, databaseFile: string, from: string, now = new Date()): string {
  const folder = backupsFolder(dataFolder);
  mkdirSync(folder, { recursive: true });
  const safety = join(folder, `avant-restauration-${stampOf(now)}.db`);
  if (existsSync(databaseFile)) copyFileSync(databaseFile, safety);
  for (const side of ["-wal", "-shm"]) rmSync(`${databaseFile}${side}`, { force: true });
  copyFileSync(from, databaseFile);
  return safety;
}

export function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}
