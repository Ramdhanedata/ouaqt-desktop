import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

/*
 * better-sqlite3, as far as this app uses it, over SQLite compiled to
 * WebAssembly.
 *
 * The builder's preview runs this app in a web page, and a web page has no
 * native modules. Every database module in electron/db is written against
 * better-sqlite3's small synchronous surface: prepare, then run, get or all;
 * transaction; pragma; exec. This file gives the same surface over the
 * official SQLite build for the web, in memory, so those modules run in the
 * preview unchanged. The same SQL, the same migrations, the same answers.
 *
 * Differences it smooths over: better-sqlite3 names a parameter "@from" in
 * the SQL and "from" in the object, where the web build wants the prefix in
 * both; and better-sqlite3 refuses booleans and undefined, which the web
 * build would store differently.
 */

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type WasmDb = InstanceType<Sqlite3["oo1"]["DB"]>;
type WasmStatement = ReturnType<WasmDb["prepare"]>;
type Value = string | number | bigint | Uint8Array | null;

let engine: Sqlite3 | null = null;

/** Loads the WebAssembly once. Everything else here is synchronous, as better-sqlite3 is. */
export async function startEngine(): Promise<void> {
  if (engine) return;
  engine = await sqlite3InitModule();
}

function value(input: unknown): Value {
  if (input === undefined || input === null) return null;
  if (typeof input === "boolean") return input ? 1 : 0;
  if (typeof input === "number" || typeof input === "string" || typeof input === "bigint") return input;
  if (input instanceof Uint8Array) return input;
  if (input instanceof Date) return input.toISOString();
  return String(input);
}

function isNamed(args: unknown[]): args is [Record<string, unknown>] {
  return args.length === 1 && args[0] !== null && typeof args[0] === "object" && !Array.isArray(args[0]) && !(args[0] instanceof Uint8Array);
}

class Statement {
  constructor(private readonly db: Database, private readonly sql: string) {}

  private withBound<T>(args: unknown[], use: (statement: WasmStatement) => T): T {
    const statement = this.db.statement(this.sql);
    try {
      const count = statement.parameterCount;
      if (count > 0) {
        if (isNamed(args)) {
          const named = args[0];
          for (let index = 1; index <= count; index += 1) {
            const name = engine!.capi.sqlite3_bind_parameter_name(statement.pointer!, index);
            const key = name ? name.slice(1) : String(index);
            statement.bind(index, value(named[key]));
          }
        } else {
          const flat = args.flat();
          for (let index = 1; index <= count; index += 1) statement.bind(index, value(flat[index - 1]));
        }
      }
      return use(statement);
    } finally {
      statement.reset(true);
    }
  }

  run(...args: unknown[]): { changes: number; lastInsertRowid: number } {
    return this.withBound(args, (statement) => {
      while (statement.step()) {
        /* a statement with RETURNING hands rows back; run ignores them, as better-sqlite3 does */
      }
      return {
        changes: Number(this.db.raw.changes()),
        lastInsertRowid: Number(engine!.capi.sqlite3_last_insert_rowid(this.db.raw.pointer!)),
      };
    });
  }

  get(...args: unknown[]): Record<string, unknown> | undefined {
    return this.withBound(args, (statement) => (statement.step() ? (statement.get({}) as Record<string, unknown>) : undefined));
  }

  all(...args: unknown[]): Record<string, unknown>[] {
    return this.withBound(args, (statement) => {
      const rows: Record<string, unknown>[] = [];
      while (statement.step()) rows.push(statement.get({}) as Record<string, unknown>);
      return rows;
    });
  }
}

export default class Database {
  readonly raw: WasmDb;
  private readonly cache = new Map<string, WasmStatement>();
  private depth = 0;

  constructor(_file?: string) {
    if (!engine) throw new Error("the database engine has not started");
    this.raw = new engine.oo1.DB(":memory:", "c");
  }

  /** A prepared statement, kept for the next call with the same SQL, as better-sqlite3 would. */
  statement(sql: string): WasmStatement {
    let statement = this.cache.get(sql);
    if (!statement) {
      statement = this.raw.prepare(sql);
      this.cache.set(sql, statement);
    }
    return statement;
  }

  prepare(sql: string): Statement {
    return new Statement(this, sql);
  }

  exec(sql: string): this {
    this.raw.exec(sql);
    return this;
  }

  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    /* Write-ahead logging and sync levels mean nothing for a database that lives in memory. */
    if (/^\s*(journal_mode|synchronous|busy_timeout)\b/i.test(source)) return options.simple ? null : [];
    const rows = this.raw.exec({ sql: `pragma ${source}`, rowMode: "object", returnValue: "resultRows" }) as Record<string, unknown>[];
    if (options.simple) {
      const first = rows[0];
      return first ? Object.values(first)[0] : undefined;
    }
    return rows;
  }

  /*
   * better-sqlite3's transaction: a function that runs the given one inside
   * BEGIN and COMMIT, rolls back if it throws, and nests as a savepoint.
   */
  transaction<A extends unknown[], T>(run: (...args: A) => T): (...args: A) => T {
    return (...args: A) => {
      const level = this.depth;
      const savepoint = `nested_${level}`;
      this.raw.exec(level === 0 ? "begin" : `savepoint ${savepoint}`);
      this.depth += 1;
      try {
        const result = run(...args);
        this.raw.exec(level === 0 ? "commit" : `release ${savepoint}`);
        return result;
      } catch (error) {
        this.raw.exec(level === 0 ? "rollback" : `rollback to ${savepoint}; release ${savepoint}`);
        throw error;
      } finally {
        this.depth -= 1;
      }
    };
  }

  backup(): Promise<void> {
    return Promise.reject(new Error("no backups in the preview"));
  }

  close(): void {
    for (const statement of this.cache.values()) statement.finalize();
    this.cache.clear();
    this.raw.close();
  }
}

export type { Database };
