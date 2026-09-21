import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

/*
 * The four columns every row in this database carries, and where they come
 * from.
 *
 * `id` is a uuid rather than an autoincrement, because two tills write rows
 * at once and neither may guess a number the other has taken. `device_id`
 * says which one wrote it. `counter` is this machine's own sequence, which is
 * how a peer knows what it has not seen yet; it is per device, so two tills
 * counting to 400 is not a conflict.
 */

export type Stamp = {
  id: string;
  device_id: string;
  created_at: string;
  counter: number;
};

/**
 * This computer's id, made once and kept. It is the `device_id` on every row
 * it writes, and it is what activation registers.
 */
export function deviceIdOf(database: Database.Database): string {
  const row = database
    .prepare("select value from settings_local where key = 'device_id'")
    .get() as { value: string } | undefined;
  if (row) return row.value;

  const id = randomUUID();
  database
    .prepare(
      "insert into settings_local (key, value, updated_at) values ('device_id', ?, ?)"
    )
    .run(id, new Date().toISOString());
  return id;
}

/*
 * The next number in this machine's sequence.
 *
 * Read and written inside whatever transaction is already open, so two rows
 * written in one sale cannot be handed the same counter.
 */
function nextCounter(database: Database.Database): number {
  const row = database
    .prepare("select value from settings_local where key = 'counter'")
    .get() as { value: string } | undefined;
  const next = (row ? Number(row.value) : 0) + 1;

  database
    .prepare(
      `insert into settings_local (key, value, updated_at) values ('counter', ?, ?)
       on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(String(next), new Date().toISOString());

  return next;
}

export function stamp(database: Database.Database, deviceId: string): Stamp {
  return {
    id: randomUUID(),
    device_id: deviceId,
    created_at: new Date().toISOString(),
    counter: nextCounter(database),
  };
}

/** Read a local setting, or null. Settings are strings; callers parse. */
export function getSetting(database: Database.Database, key: string): string | null {
  const row = database
    .prepare("select value from settings_local where key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(
  database: Database.Database,
  key: string,
  value: string
): void {
  database
    .prepare(
      `insert into settings_local (key, value, updated_at) values (?, ?, ?)
       on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, new Date().toISOString());
}
