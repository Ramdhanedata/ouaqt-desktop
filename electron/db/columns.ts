import type Database from "better-sqlite3";
import { audit } from "./audit";
import { stamp } from "./rows";

/*
 * The owner's own columns, on the lists he works from: stock and customers.
 *
 * Two kinds, kept apart on purpose. The app's own columns are the ones it
 * computes with, and they can be renamed, moved and hidden but never
 * deleted. His own are his to add and remove, and each has a type chosen
 * when it is made: text, number, date, yes or no, or a list of choices he
 * writes. A column that silently holds numbers as text is how reports start
 * lying, so a value is checked against its column's type before it is kept.
 */

export type ListName = "products" | "customers";
export type ColumnType = "text" | "number" | "date" | "yesno" | "choice";

export type Column = {
  id: string;
  list: ListName;
  /** For one of the app's columns, its name in the app; for his, the column's id. */
  key: string;
  system: boolean;
  /** His name for it, or null to keep the app's own words. */
  label: string | null;
  type: ColumnType | null;
  choices: string[];
  position: number;
  hidden: boolean;
};

/* The columns each list has before the owner changes anything, in their first order. */
export const SYSTEM_COLUMNS: Record<ListName, string[]> = {
  products: ["name", "category", "stock", "price", "expiry"],
  customers: ["name", "phone", "balance"],
};

/* The one column that says which row it is: it can be renamed and moved, not hidden. */
export const IDENTITY = "name";

export const CUSTOM_LIMIT = 20; // not-a-rule: the brief's own ceiling per list
const TYPES: ColumnType[] = ["text", "number", "date", "yesno", "choice"];
const LABEL_MAX = 40; // not-a-rule: a column heading, not a sentence
const TEXT_MAX = 500; // not-a-rule: a note in a cell, not a document

type Row = { id: string; list: ListName; key: string; system: number; label: string | null; type: ColumnType | null; choices: string | null; position: number; hidden: number };

const toColumn = (row: Row): Column => ({
  id: row.id,
  list: row.list,
  key: row.key,
  system: row.system === 1,
  label: row.label,
  type: row.type,
  choices: row.choices ? (JSON.parse(row.choices) as string[]) : [],
  position: row.position,
  hidden: row.hidden === 1,
});

function isList(list: string): list is ListName {
  return list === "products" || list === "customers";
}

/* Every column of a list, in his order. The app's own are written down the first time they are asked for. */
export function listColumns(database: Database.Database, deviceId: string, list: ListName): Column[] {
  if (!isList(list)) throw new Error("no such list");
  const have = new Set((database.prepare("select key from list_columns where list = ?").all(list) as { key: string }[]).map((row) => row.key));
  const missing = SYSTEM_COLUMNS[list].filter((key) => !have.has(key));
  if (missing.length > 0) {
    const write = database.transaction(() => {
      let last = (database.prepare("select coalesce(max(position), 0) as p from list_columns where list = ?").get(list) as { p: number }).p;
      for (const key of missing) {
        const row = stamp(database, deviceId);
        last += 1;
        database
          .prepare(
            `insert into list_columns (id, device_id, created_at, counter, list, key, system, position)
             values (@id, @device_id, @created_at, @counter, @list, @key, 1, @position)`
          )
          .run({ ...row, list, key, position: last });
      }
    });
    write();
  }
  return (database.prepare("select * from list_columns where list = ? order by position, created_at").all(list) as Row[]).map(toColumn);
}

function cleanLabel(label: string): string {
  const clean = label.trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("a column needs a name");
  if (clean.length > LABEL_MAX) throw new Error("that name is too long");
  return clean;
}

function cleanChoices(choices: string[]): string[] {
  const clean = [...new Set(choices.map((one) => one.trim()).filter(Boolean))];
  if (clean.length === 0) throw new Error("a list of choices needs at least one");
  return clean.slice(0, 50);
}

export function addColumn(
  database: Database.Database,
  deviceId: string,
  list: ListName,
  input: { label: string; type: ColumnType; choices?: string[] }
): Column {
  const columns = listColumns(database, deviceId, list);
  if (columns.filter((column) => !column.system).length >= CUSTOM_LIMIT) throw new Error("limit");
  if (!TYPES.includes(input.type)) throw new Error("no such type");
  const label = cleanLabel(input.label);
  const choices = input.type === "choice" ? cleanChoices(input.choices ?? []) : null;
  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into list_columns (id, device_id, created_at, counter, list, key, system, label, type, choices, position)
       values (@id, @device_id, @created_at, @counter, @list, @key, 0, @label, @type, @choices, @position)`
    )
    .run({
      ...row,
      list,
      key: row.id,
      label,
      type: input.type,
      choices: choices ? JSON.stringify(choices) : null,
      position: Math.max(0, ...columns.map((column) => column.position)) + 1,
    });
  audit(database, deviceId, { staffId: null, subject: "column", subjectId: row.id, action: "added", detail: { list, label, type: input.type } });
  return listColumns(database, deviceId, list).find((column) => column.id === row.id) as Column;
}

function columnById(database: Database.Database, id: string): Column {
  const row = database.prepare("select * from list_columns where id = ?").get(id) as Row | undefined;
  if (!row) throw new Error("no such column");
  return toColumn(row);
}

/* A new name, or null to go back to the app's own words for one of its columns. */
export function renameColumn(database: Database.Database, id: string, label: string | null): void {
  const column = columnById(database, id);
  const next = label === null || !label.trim() ? (column.system ? null : cleanLabel(column.label ?? "")) : cleanLabel(label);
  database.prepare("update list_columns set label = ? where id = ?").run(next, id);
}

export function setColumnHidden(database: Database.Database, id: string, hidden: boolean): void {
  const column = columnById(database, id);
  if (column.system && column.key === IDENTITY && hidden) throw new Error("the name stays");
  database.prepare("update list_columns set hidden = ? where id = ?").run(hidden ? 1 : 0, id);
}

export function setColumnChoices(database: Database.Database, id: string, choices: string[]): void {
  const column = columnById(database, id);
  if (column.type !== "choice") throw new Error("not a list of choices");
  database.prepare("update list_columns set choices = ? where id = ?").run(JSON.stringify(cleanChoices(choices)), id);
}

/*
 * One place earlier or later. "Among" is the columns the owner can see
 * where he is moving it: a restaurant's menu has no expiry column, so moving
 * past it would look like a click that did nothing.
 */
export function moveColumn(database: Database.Database, deviceId: string, id: string, direction: "up" | "down", among?: string[]): void {
  const column = columnById(database, id);
  const columns = listColumns(database, deviceId, column.list);
  const seen = among && among.length > 0 ? columns.filter((one) => among.includes(one.id)) : columns;
  const index = seen.findIndex((one) => one.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= seen.length) return;
  const other = seen[target].id;
  const write = database.transaction(() => {
    const order = columns.map((one) => one.id);
    const from = order.indexOf(id);
    const to = order.indexOf(other);
    [order[from], order[to]] = [order[to], order[from]];
    order.forEach((one, position) => database.prepare("update list_columns set position = ? where id = ?").run(position + 1, one));
  });
  write();
}

/* His own column, and everything written in it. The app's columns cannot go. */
export function deleteColumn(database: Database.Database, deviceId: string, id: string): void {
  const column = columnById(database, id);
  if (column.system) throw new Error("the app's own columns cannot be deleted");
  const write = database.transaction(() => {
    const removed = database.prepare("delete from column_values where column_id = ?").run(id).changes;
    database.prepare("delete from list_columns where id = ?").run(id);
    audit(database, deviceId, { staffId: null, subject: "column", subjectId: id, action: "deleted", detail: { list: column.list, label: column.label, values: removed } });
  });
  write();
}

/* Every value of a list's own columns, by row and then by column. */
export function columnValues(database: Database.Database, list: ListName): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const row of database.prepare("select row_id, column_id, value from column_values where list = ?").all(list) as { row_id: string; column_id: string; value: string }[]) {
    (out[row.row_id] ??= {})[row.column_id] = row.value;
  }
  return out;
}

/*
 * A value, checked against its column's type before it is kept. An empty
 * value clears the cell. Numbers are kept with a dot, dates as YYYY-MM-DD,
 * yes or no as 1 or 0, a choice only if it is one of the column's.
 */
export function setColumnValue(database: Database.Database, list: ListName, rowId: string, columnId: string, value: string | null): void {
  const column = columnById(database, columnId);
  if (column.system || column.list !== list) throw new Error("not one of his columns");
  const raw = (value ?? "").trim();
  if (!raw) {
    database.prepare("delete from column_values where list = ? and row_id = ? and column_id = ?").run(list, rowId, columnId);
    return;
  }
  let kept: string;
  switch (column.type) {
    case "number": {
      const clean = raw.replace(/\s/g, "").replace(",", ".");
      if (!/^-?\d+(\.\d+)?$/.test(clean)) throw new Error("not a number");
      kept = clean;
      break;
    }
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("not a date");
      kept = raw;
      break;
    case "yesno":
      if (raw !== "1" && raw !== "0") throw new Error("yes or no");
      kept = raw;
      break;
    case "choice":
      if (!column.choices.includes(raw)) throw new Error("not one of the choices");
      kept = raw;
      break;
    default:
      kept = raw.slice(0, TEXT_MAX);
  }
  database
    .prepare(
      `insert into column_values (list, row_id, column_id, value) values (?, ?, ?, ?)
       on conflict (list, row_id, column_id) do update set value = excluded.value`
    )
    .run(list, rowId, columnId, kept);
}
