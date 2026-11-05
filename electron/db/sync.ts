import type Database from "better-sqlite3";
import { deviceIdOf, getSetting, setSetting } from "./rows";

/*
 * A shop's devices seeing each other's work: the database's side of it.
 *
 * Triggers note every row this device changes, in every trade's tables, so no
 * screen and no database module has to remember to. What the others send is
 * merged by rules that cannot lose a sale:
 *
 *   Stock is movements and a sale is its own row, so two devices selling apart
 *   simply add up. Nothing is overwritten, and stock can go below zero, where
 *   the owner sees it and corrects it. No sale is ever refused for it.
 *
 *   A row that really is edited (a price, an order's status) keeps its latest
 *   edit. An edit made after seeing the other device's always wins. Two made
 *   apart are settled by time, then by device, the same way on every device.
 *
 *   The same thing made on two devices (a product imported on both, the same
 *   member of staff) becomes one, by its name, not two.
 *
 * The same change arriving twice, or late, changes nothing, so anything can be
 * sent again safely. Network and encryption live in electron/sync/.
 */

/* What belongs to this device alone: its printer, its language, its place in the conversation. */
const NOT_SHARED = new Set(["settings_local", "schema_migrations", "sync_state", "sync_control", "sync_log", "sync_versions", "sync_alias", "sync_pending"]);
const isShared = (name: string) => !NOT_SHARED.has(name) && !name.startsWith("sqlite_") && !name.startsWith("products_search");

/* Sent first, so a sale's product is known by the time the sale arrives. */
const FIRST = ["products", "customers", "staff", "suppliers", "locations", "list_columns", "payment_apps", "rooms", "routes", "vehicles", "receptions", "batches"];

/* Columns that point at something which may be known here under another id. */
const POINTS_AT: Record<string, string> = {
  product_id: "products",
  customer_id: "customers",
  staff_id: "staff",
  supplier_id: "suppliers",
  batch_id: "batches",
  location_id: "locations",
  room_id: "rooms",
  route_id: "routes",
  vehicle_id: "vehicles",
  column_id: "list_columns",
};

/* What makes two rows made apart the same thing to the owner. */
const SAME_THING: Record<string, string[]> = {
  products: ["name", "barcode"],
  customers: ["name", "phone"],
  staff: ["name"],
  suppliers: ["name"],
  locations: ["name"],
  payment_apps: ["name"],
  list_columns: ["list", "key"],
  rooms: ["number"],
  routes: ["origin", "destination"],
  vehicles: ["plate"],
  batches: ["product_id", "lot", "expires_on"],
};

/* Never overwritten when a row is updated: who first made it stays who first made it. */
const BIRTH = new Set(["id", "device_id", "created_at", "counter"]);

export type SyncRow = {
  /** The table. */
  t: string;
  /** The row's key on the device that sent it. */
  i: string;
  /** How many times it has changed. */
  n: number;
  /** When it last changed. */
  a: string;
  /** Which device last changed it. */
  d: string;
  /** Deleted. */
  x?: 1;
  /** The row, unless deleted. */
  v?: Record<string, unknown>;
};

type Shape = { name: string; columns: string[]; keys: string[] };

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

function shapesOf(database: Database.Database): Shape[] {
  const names = (database.prepare("select name from sqlite_master where type = 'table' order by rowid").all() as { name: string }[])
    .map((row) => row.name)
    .filter(isShared);
  const rank = (name: string) => {
    const place = FIRST.indexOf(name);
    return place === -1 ? FIRST.length : place;
  };
  return [...names]
    .sort((a, b) => rank(a) - rank(b))
    .map((name) => {
      const info = database.prepare(`select name, pk from pragma_table_info(${`'${name}'`})`).all() as { name: string; pk: number }[];
      return {
        name,
        columns: info.map((column) => column.name),
        keys: info.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name),
      };
    })
    .filter((shape) => shape.keys.length > 0);
}

const rowKey = (shape: Shape, row: Record<string, unknown>) =>
  shape.keys.length === 1 ? String(row[shape.keys[0]]) : JSON.stringify(shape.keys.map((key) => row[key]));
const keyValues = (shape: Shape, id: string): unknown[] => (shape.keys.length === 1 ? [id] : (JSON.parse(id) as unknown[]));
const whereKey = (shape: Shape) => shape.keys.map((key) => `${quote(key)} = ?`).join(" and ");

/*
 * The triggers, written at each opening from the tables as they are now, so a
 * table a later version adds is covered without anybody remembering to.
 */
export function watchChanges(database: Database.Database): void {
  deviceIdOf(database);
  for (const shape of shapesOf(database)) {
    const key = (row: "new" | "old") =>
      shape.keys.length === 1 ? `${row}.${quote(shape.keys[0])}` : `json_array(${shape.keys.map((name) => `${row}.${quote(name)}`).join(", ")})`;
    for (const [event, row, deleted] of [["insert", "new", 0], ["update", "new", 0], ["delete", "old", 1]] as const) {
      database.exec(`
        create trigger if not exists ${quote(`sync_${event}_${shape.name}`)} after ${event} on ${quote(shape.name)}
        when (select applying from sync_control) = 0
        begin
          insert into sync_log (tbl, row_id) values ('${shape.name}', ${key(row)});
          insert into sync_versions (tbl, row_id, n, at, device, deleted)
          values ('${shape.name}', ${key(row)}, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), (select value from settings_local where key = 'device_id'), ${deleted})
          on conflict (tbl, row_id) do update set n = n + 1, at = excluded.at, device = excluded.device, deleted = excluded.deleted;
        end;
      `);
    }
  }
}

/*
 * The first time this shop shares: everything it already holds is queued, and
 * the others are asked for everything they hold. A device restored from a
 * backup starts here again, since it no longer knows what it has missed.
 */
export function startSharing(database: Database.Database): boolean {
  if (getSetting(database, "sync_ready") === "1") return false;
  const me = deviceIdOf(database);
  const write = database.transaction(() => {
    for (const shape of shapesOf(database)) {
      const made = shape.columns.includes("created_at") && shape.columns.includes("device_id");
      const key = shape.keys.length === 1 ? quote(shape.keys[0]) : `json_array(${shape.keys.map(quote).join(", ")})`;
      database
        .prepare(
          `insert or ignore into sync_versions (tbl, row_id, n, at, device, deleted)
           select ?, ${key}, 1, ${made ? "created_at" : "'2000-01-01T00:00:00.000Z'"}, ${made ? "device_id" : "?"}, 0 from ${quote(shape.name)}`
        )
        .run(...(made ? [shape.name] : [shape.name, me]));
    }
    queueEverything(database);
    setSetting(database, "sync_ready", "1");
    setSetting(database, "sync_ask_again", "1");
  });
  write();
  return true;
}

/* Everything known, whoever made it: for a device that has just joined, or lost its place. */
export function queueEverything(database: Database.Database): void {
  const write = database.transaction(() => {
    for (const shape of shapesOf(database)) {
      database.prepare("insert into sync_log (tbl, row_id) select tbl, row_id from sync_versions where tbl = ?").run(shape.name);
    }
  });
  write();
}

export function waitingToSend(database: Database.Database): number {
  return (database.prepare("select count(*) as n from sync_log").get() as { n: number }).n;
}

const BATCH_ROWS = 500; // not-a-rule: how many queued rows are looked at in one go

/*
 * The next changes to send, up to a size. Rows are read as they stand now, so
 * a row changed five times goes once. What is sent is only forgotten by
 * markSent, once the server has it; a change made meanwhile stays queued.
 */
export function nextChanges(database: Database.Database, maxBytes: number, after = 0): { rows: SyncRow[]; upTo: number } {
  const queued = database.prepare("select seq, tbl, row_id from sync_log where seq > ? order by seq limit ?").all(after, BATCH_ROWS) as { seq: number; tbl: string; row_id: string }[];
  const shapes = new Map(shapesOf(database).map((shape) => [shape.name, shape]));
  const seen = new Set<string>();
  const rows: SyncRow[] = [];
  let bytes = 0;
  let upTo = 0;
  for (const entry of queued) {
    const label = `${entry.tbl}\u0000${entry.row_id}`;
    const shape = shapes.get(entry.tbl);
    const version = database.prepare("select n, at, device, deleted from sync_versions where tbl = ? and row_id = ?").get(entry.tbl, entry.row_id) as
      | { n: number; at: string; device: string; deleted: number }
      | undefined;
    if (seen.has(label) || !shape || !version) {
      upTo = entry.seq;
      continue;
    }
    const value = version.deleted
      ? undefined
      : (database.prepare(`select * from ${quote(entry.tbl)} where ${whereKey(shape)}`).get(...keyValues(shape, entry.row_id)) as Record<string, unknown> | undefined);
    const row: SyncRow = { t: entry.tbl, i: entry.row_id, n: version.n, a: version.at, d: version.device, ...(value ? { v: value } : { x: 1 as const }) };
    const size = JSON.stringify(row).length;
    if (bytes + size > maxBytes && rows.length > 0) break;
    bytes += size;
    rows.push(row);
    seen.add(label);
    upTo = entry.seq;
  }
  return { rows, upTo };
}

export function markSent(database: Database.Database, upTo: number): void {
  database.prepare("delete from sync_log where seq <= ?").run(upTo);
}

const later = (row: Pick<SyncRow, "n" | "a" | "d">, mine: { n: number; at: string; device: string }) =>
  row.n !== mine.n ? row.n > mine.n : row.a !== mine.at ? row.a > mine.at : row.d > mine.device;

function ourId(database: Database.Database, table: string, id: string): string {
  const alias = database.prepare("select local_id from sync_alias where tbl = ? and remote_id = ?").get(table, id) as { local_id: string } | undefined;
  return alias ? alias.local_id : id;
}

/* The same thing already here, made on another device. */
function twinOf(database: Database.Database, shape: Shape, row: SyncRow, value: Record<string, unknown>): string | null {
  /* What a shop had on the shelf at activation is one stock, however many devices were activated. */
  if (shape.name === "stock_movements" && value.reference === "activation") {
    const found = database
      .prepare("select id from stock_movements where product_id = ? and reference = 'activation' and id != ? and device_id != ? limit 1")
      .get(value.product_id, row.i, value.device_id) as { id: string } | undefined;
    return found ? found.id : null;
  }
  const columns = SAME_THING[shape.name];
  if (!columns || !columns.every((column) => shape.columns.includes(column))) return null;
  /* Only another device's row: two made on one device were made as two on purpose. */
  const found = database
    .prepare(`select id from ${quote(shape.name)} where ${columns.map((column) => `${quote(column)} is ?`).join(" and ")} and id != ? and device_id != ? limit 1`)
    .get(...columns.map((column) => value[column] ?? null), row.i, value.device_id) as { id: string } | undefined;
  return found ? found.id : null;
}

function keepForLater(database: Database.Database, row: SyncRow): void {
  database.prepare("insert into sync_pending (payload) values (?)").run(JSON.stringify(row));
}

function applyOne(database: Database.Database, shapes: Map<string, Shape>, row: SyncRow, again: boolean): boolean {
  const shape = shapes.get(row.t);
  /* A table this version has not got yet: another device was updated first. */
  if (!shape) {
    if (!again) keepForLater(database, row);
    return false;
  }

  const value = row.v ? { ...row.v } : null;
  if (value) {
    for (const column of Object.keys(value)) {
      const table = POINTS_AT[column];
      if (table && typeof value[column] === "string") value[column] = ourId(database, table, value[column] as string);
    }
    if (row.t === "column_values" && typeof value.row_id === "string" && typeof value.list === "string") {
      value.row_id = ourId(database, value.list, value.row_id);
    }
  }

  let id: string;
  if (shape.keys.length > 1) {
    if (value) id = rowKey(shape, value);
    else {
      /* A deleted cell: its key is all there is, and it may name things known here under other ids. */
      const [list, rowId, columnId] = JSON.parse(row.i) as string[];
      id = row.t === "column_values" ? JSON.stringify([list, ourId(database, list, rowId), ourId(database, "list_columns", columnId)]) : row.i;
    }
  } else {
    id = ourId(database, row.t, row.i);
    const known = database.prepare("select 1 from sync_versions where tbl = ? and row_id = ?").get(row.t, id);
    if (value && !known && id === row.i) {
      const twin = twinOf(database, shape, row, value);
      if (twin) {
        database.prepare("insert or replace into sync_alias (tbl, remote_id, local_id) values (?, ?, ?)").run(row.t, row.i, twin);
        id = twin;
      }
    }
    if (value) value[shape.keys[0]] = id;
  }

  const mine = database.prepare("select n, at, device from sync_versions where tbl = ? and row_id = ?").get(row.t, id) as { n: number; at: string; device: string } | undefined;
  if (mine && !later(row, mine) && !again) return false;

  if (!value) {
    database.prepare(`delete from ${quote(row.t)} where ${whereKey(shape)}`).run(...keyValues(shape, id));
  } else {
    const columns = Object.keys(value).filter((column) => shape.columns.includes(column));
    /* A column this version has not got yet: what fits goes in now, the whole row again after the update. */
    if (!again && columns.length !== Object.keys(value).length) keepForLater(database, row);
    const write = () => {
      const changes = columns.filter((column) => !BIRTH.has(column) && !shape.keys.includes(column));
      database
        .prepare(
          `insert into ${quote(row.t)} (${columns.map(quote).join(", ")}) values (${columns.map(() => "?").join(", ")})
           on conflict (${shape.keys.map(quote).join(", ")}) ${changes.length ? `do update set ${changes.map((column) => `${quote(column)} = excluded.${quote(column)}`).join(", ")}` : "do nothing"}`
        )
        .run(...columns.map((column) => value[column] ?? null));
    };
    try {
      write();
    } catch (error) {
      const message = String((error as Error).message ?? error);
      /* A parcel's code counts that device's parcels, so two apart can land on the same one. */
      if (row.t === "parcels" && message.includes("parcels.code") && typeof value.code === "string") {
        value.code = `${value.code}-${row.d.slice(0, 2).toUpperCase()}`;
        write();
      } else {
        console.error("a change from another device could not be kept yet:", row.t, message);
        if (!again) keepForLater(database, row);
        return false;
      }
    }
  }

  database
    .prepare(
      `insert into sync_versions (tbl, row_id, n, at, device, deleted) values (?, ?, ?, ?, ?, ?)
       on conflict (tbl, row_id) do update set n = excluded.n, at = excluded.at, device = excluded.device, deleted = excluded.deleted`
    )
    .run(row.t, id, row.n, row.a, row.d, row.x ? 1 : 0);
  return true;
}

/*
 * Writes what another device sent. Its rows can arrive in any order, a sale
 * before its customer, so nothing waits on another row: foreign keys are off
 * for this one transaction, and the missing row simply arrives next.
 */
export function applyChanges(database: Database.Database, rows: SyncRow[]): number {
  if (rows.length === 0) return 0;
  const shapes = new Map(shapesOf(database).map((shape) => [shape.name, shape]));
  let changed = 0;
  database.pragma("foreign_keys = OFF");
  try {
    const write = database.transaction(() => {
      database.prepare("update sync_control set applying = 1").run();
      for (const row of rows) if (applyOne(database, shapes, row, false)) changed += 1;
      database.prepare("update sync_control set applying = 0").run();
    });
    write();
  } finally {
    database.pragma("foreign_keys = ON");
  }
  return changed;
}

/* What an earlier version could not take. Tried again at each start, so an update picks them up. */
export function tryKeptChanges(database: Database.Database): number {
  const kept = database.prepare("select id, payload from sync_pending order by id").all() as { id: number; payload: string }[];
  if (kept.length === 0) return 0;
  const shapes = new Map(shapesOf(database).map((shape) => [shape.name, shape]));
  let changed = 0;
  database.pragma("foreign_keys = OFF");
  try {
    const write = database.transaction(() => {
      database.prepare("update sync_control set applying = 1").run();
      for (const one of kept) {
        const row = JSON.parse(one.payload) as SyncRow;
        const fits = shapes.has(row.t) && Object.keys(row.v ?? {}).every((column) => shapes.get(row.t)?.columns.includes(column));
        if (!fits) continue;
        if (applyOne(database, shapes, row, true)) changed += 1;
        database.prepare("delete from sync_pending where id = ?").run(one.id);
      }
      database.prepare("update sync_control set applying = 0").run();
    });
    write();
  } finally {
    database.pragma("foreign_keys = ON");
  }
  return changed;
}
