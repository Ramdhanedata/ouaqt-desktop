import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppLanguage, Configuration } from "@app-ui/config";
import { formatMoney, formatQuantity } from "@app-ui/format";
import { machine, type Column, type ColumnType, type ListName, type ListShape, type PrintedTable } from "./bridge";
import { fill, type ScreensCopy } from "./i18n/screens";
import { icons } from "./icons";
import { sectionsFor } from "./shell";
import { Button, Choices, Field, Notice, Panel, Toggle, localDay } from "./ui";

/*
 * The owner's lists, in the shape he gave them.
 *
 * A list screen says which of the app's columns it can show and how to draw
 * each one. Everything else comes from the database: his names for them,
 * their order, which are hidden, and his own columns with what he wrote in
 * them. Sorting, filtering, the totals, the spreadsheet and the printed page
 * all read the same visible columns in the same order, so what he sees is
 * what he exports and what he prints.
 */

/* One of the app's own columns, as a list screen draws it. */
export type SystemColumn<Row> = {
  label: string;
  align?: "start" | "end";
  cell: (row: Row) => ReactNode;
  /** The same cell as plain text, for the spreadsheet and the printed page. */
  text: (row: Row) => string;
  /** What it sorts by; without it the column does not sort. */
  sort?: (row: Row) => string | number | null;
  /** A figure at the foot of the list, where adding up means something. */
  total?: (rows: Row[]) => string;
};

export function useListShape(list: ListName) {
  const [shape, setShape] = useState<ListShape | null>(null);
  const reload = useCallback(() => {
    void machine.columns(list).then((answer) => answer.ok && setShape(answer.value));
  }, [list]);
  useEffect(reload, [reload]);
  return { shape, reload };
}

/* Which lists a shop has, and which of the app's columns make sense in its trade. */
export function listsFor(configuration: Configuration): { list: ListName; applicable: string[] }[] {
  const sections = sectionsFor(configuration);
  const lists: { list: ListName; applicable: string[] }[] = [];
  if (sections.some((section) => section === "stock" || section === "menu" || section === "extras")) {
    lists.push({
      list: "products",
      applicable: ["name", "category", ...(sections.includes("stock") ? ["stock"] : []), "price", ...(configuration.pack === "pharmacy" ? ["expiry"] : [])],
    });
  }
  if (sections.includes("customers")) lists.push({ list: "customers", applicable: ["name", "phone", "balance"] });
  return lists;
}

export function systemLabels(list: ListName, t: ScreensCopy): Record<string, string> {
  return list === "products"
    ? { name: t.colName, category: t.colCategory, stock: t.colStock, price: t.colPrice, expiry: t.colExpiry }
    : { name: t.customerName, phone: t.customerPhone, balance: t.balance };
}

export function labelOf(column: Column, labels: Record<string, string>): string {
  return column.label ?? labels[column.key] ?? column.key;
}

function typeName(type: ColumnType | null, t: ScreensCopy): string {
  switch (type) {
    case "number":
      return t.typeNumber;
    case "date":
      return t.typeDate;
    case "yesno":
      return t.typeYesNo;
    case "choice":
      return t.typeChoice;
    default:
      return t.typeText;
  }
}

/* Plain text for a value of his own, the way the screen writes it. Yes or no left empty counts as no. */
export function customText(column: Column, raw: string | undefined, t: ScreensCopy, language: AppLanguage): string {
  if (column.type === "yesno") return raw === "1" ? t.yes : t.no;
  if (raw === undefined || raw === "") return "";
  switch (column.type) {
    case "number":
      return formatQuantity(Number(raw), language);
    case "date":
      return plainDay(raw, language);
    default:
      return raw;
  }
}

/* A date as the printed page and the spreadsheet write it: as on screen, without direction marks. */
export function plainDay(date: string | null, language: AppLanguage): string {
  if (!date) return "";
  const [year, month, dayOfMonth] = date.split("-");
  return language === "en" ? date : `${dayOfMonth}/${month}/${year}`;
}

/* Money as the printed page and the spreadsheet write it: no direction marks, which a spreadsheet shows as boxes. */
export function moneyPlain(minor: number, language: AppLanguage): string {
  return formatMoney(minor, language);
}

type Sort = { id: string; down: boolean };

export function ListTable<Row extends { id: string }>({
  list,
  t,
  language,
  title,
  rows,
  system,
  shape,
  onShape,
  onOpen,
  empty,
}: {
  list: ListName;
  t: ScreensCopy;
  language: AppLanguage;
  /** The list's name on the printed page and in the file's name. */
  title: string;
  rows: Row[];
  system: Record<string, SystemColumn<Row>>;
  shape: ListShape | null;
  onShape: () => void;
  onOpen: (row: Row) => void;
  /** What to show when no row is left to show. */
  empty: ReactNode;
}) {
  const [sort, setSort] = useState<Sort | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [managing, setManaging] = useState(false);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);

  const labels = useMemo(() => Object.fromEntries(Object.entries(system).map(([key, column]) => [key, column.label])), [system]);
  const columns = useMemo(
    () => (shape?.columns ?? []).filter((column) => !column.hidden && (column.system ? column.key in system : true)),
    [shape, system]
  );
  const values = shape?.values ?? {};
  const filterable = columns.filter((column) => !column.system && (column.type === "choice" || column.type === "yesno"));

  const shown = useMemo(() => {
    const kept = rows.filter((row) =>
      filterable.every((column) => {
        const wanted = filters[column.id];
        if (!wanted) return true;
        const value = values[row.id]?.[column.id] ?? "";
        return column.type === "yesno" ? (wanted === "1") === (value === "1") : value === wanted;
      })
    );
    const column = sort ? columns.find((one) => one.id === sort.id) : undefined;
    if (!sort || !column) return kept;
    const key = (row: Row): string | number | null => {
      if (column.system) return system[column.key]?.sort?.(row) ?? null;
      const raw = values[row.id]?.[column.id];
      if (column.type === "yesno") return raw === "1" ? 1 : 0;
      if (raw === undefined || raw === "") return null;
      return column.type === "number" ? Number(raw) : raw.toLocaleLowerCase();
    };
    const collator = new Intl.Collator(language, { numeric: true, sensitivity: "base" });
    return [...kept].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      /* Empty cells go last whichever way the list is turned. */
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      const order = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
      return sort.down ? -order : order;
    });
  }, [rows, filters, sort, columns, filterable, values, system, language]);

  const alignOf = (column: Column): "start" | "end" =>
    column.system ? (system[column.key]?.align ?? "start") : column.type === "number" ? "end" : "start";

  const totalOf = (column: Column): string | null => {
    if (column.system) return system[column.key]?.total?.(shown) ?? null;
    if (column.type !== "number") return null;
    const sum = shown.reduce((all, row) => {
      const raw = values[row.id]?.[column.id];
      return raw ? all + Number(raw) : all;
    }, 0);
    return formatQuantity(sum, language);
  };
  const totals = columns.map(totalOf);
  const hasTotals = shown.length > 0 && totals.some((one) => one !== null);

  const textOf = (row: Row, column: Column): string =>
    column.system ? (system[column.key]?.text(row) ?? "") : customText(column, values[row.id]?.[column.id], t, language);

  const printable = (): PrintedTable => ({
    title,
    header: columns.map((column) => labelOf(column, labels)),
    align: columns.map(alignOf),
    rows: shown.map((row) => columns.map((column) => textOf(row, column))),
    totals: hasTotals ? totals.map((one, index) => one ?? (index === 0 ? t.total : "")) : null,
  });

  const fileName = `${title}-${localDay()}`;

  const cycle = (column: Column) =>
    setSort((current) => (current?.id !== column.id ? { id: column.id, down: false } : current.down ? null : { id: column.id, down: true }));

  const sortable = (column: Column) => (column.system ? Boolean(system[column.key]?.sort) : true);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end gap-3">
        {filterable.map((column) => (
          <label key={column.id} className="block">
            <span className="text-base text-ink-2">{labelOf(column, labels)}</span>
            <select
              value={filters[column.id] ?? ""}
              onChange={(event) => setFilters((current) => ({ ...current, [column.id]: event.target.value }))}
              className="mt-1 block min-h-[48px] min-w-[140px] rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink"
            >
              <option value="">{t.filterAll}</option>
              {column.type === "yesno" ? (
                <>
                  <option value="1">{t.yes}</option>
                  <option value="0">{t.no}</option>
                </>
              ) : (
                column.choices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))
              )}
            </select>
          </label>
        ))}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button onClick={() => setManaging(true)}>
            <span className="flex items-center gap-2">
              <icons.columns size={20} />
              {t.columnsButton}
            </span>
          </Button>
          <Button
            disabled={shown.length === 0}
            onClick={() =>
              void machine.exportList(printable(), fileName).then((answer) => {
                if (!answer.ok) setNote({ text: t.notSaved, kind: "problem" });
                else if (answer.value) setNote({ text: fill(t.listSaved, { file: answer.value }), kind: "done" });
              })
            }
          >
            {t.export}
          </Button>
          <Button
            disabled={shown.length === 0}
            onClick={() =>
              void machine.printList(printable(), fileName).then((answer) => {
                setNote(answer.ok ? null : { text: t.listPrintFailed, kind: "problem" });
              })
            }
          >
            {t.printList}
          </Button>
        </div>
      </div>
      {note ? (
        <div className="mt-3">
          <Notice kind={note.kind} text={note.text} />
        </div>
      ) : null}

      {shown.length === 0 ? (
        empty
      ) : (
        <table className="mt-4 w-full border-collapse text-base">
          <thead>
            <tr className="border-b-2 border-line text-ink-3">
              {columns.map((column) => {
                const align = alignOf(column) === "end" ? "text-end" : "text-start";
                const sorted = sort?.id === column.id ? sort : null;
                return (
                  <th
                    key={column.id}
                    className={`px-3 py-1 font-normal first:ps-0 last:pe-0 ${align}`}
                    aria-sort={sorted ? (sorted.down ? "descending" : "ascending") : undefined}
                  >
                    {sortable(column) ? (
                      <button
                        type="button"
                        onClick={() => cycle(column)}
                        className={`inline-flex min-h-[44px] items-center gap-1 rounded hover:text-ink ${sorted ? "font-semibold text-ink" : ""}`}
                      >
                        {labelOf(column, labels)}
                        {sorted ? sorted.down ? <icons.down size={16} /> : <icons.up size={16} /> : null}
                      </button>
                    ) : (
                      labelOf(column, labels)
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id} onClick={() => onOpen(row)} className="cursor-pointer border-b border-line hover:bg-hover">
                {columns.map((column) => (
                  <td key={column.id} className={`px-3 py-3 align-top first:ps-0 last:pe-0 ${alignOf(column) === "end" ? "text-end" : "text-start"}`}>
                    {column.system ? (
                      system[column.key]?.cell(row)
                    ) : column.type === "yesno" ? (
                      <span className={values[row.id]?.[column.id] === "1" ? "" : "text-ink-3"}>{textOf(row, column)}</span>
                    ) : (
                      <bdi>{textOf(row, column)}</bdi>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {hasTotals ? (
            <tfoot>
              <tr className="border-t-2 border-line-strong font-semibold">
                {totals.map((one, index) => (
                  <td key={columns[index].id} className={`px-3 py-3 first:ps-0 last:pe-0 ${alignOf(columns[index]) === "end" ? "text-end" : "text-start"}`}>
                    <bdi>{one ?? (index === 0 ? t.total : "")}</bdi>
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      )}

      {managing && shape ? (
        <Panel title={fill(t.columnsTitle, { list: title })} onClose={() => setManaging(false)} closeLabel={t.close}>
          <ColumnManager list={list} t={t} labels={labels} applicable={Object.keys(system)} shape={shape} onChanged={onShape} />
        </Panel>
      ) : null}
    </div>
  );
}

const TYPES: ColumnType[] = ["text", "number", "date", "yesno", "choice"];

function choicesFrom(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/*
 * The columns of one list, to arrange: rename, move, hide, and for his own,
 * change the choices or delete. Used from Settings and from the list itself.
 */
export function ColumnManager({
  list,
  t,
  labels,
  applicable,
  shape,
  onChanged,
}: {
  list: ListName;
  t: ScreensCopy;
  labels: Record<string, string>;
  applicable: string[];
  shape: ListShape;
  onChanged: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Column | null>(null);
  const [editingChoices, setEditingChoices] = useState<string | null>(null);
  const [choicesText, setChoicesText] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [newChoices, setNewChoices] = useState("");

  const columns = shape.columns.filter((column) => (column.system ? applicable.includes(column.key) : true));
  const seen = columns.map((column) => column.id);
  const own = shape.columns.filter((column) => !column.system).length;
  const full = own >= shape.limit;

  const after = (answer: { ok: boolean; reason?: string }) => {
    setProblem(answer.ok ? null : answer.reason === "read_only" ? t.readOnly : t.columnNotSaved);
    onChanged();
    return answer.ok;
  };

  const canAdd = name.trim() !== "" && (type !== "choice" || choicesFrom(newChoices).length > 0);

  const add = () => {
    if (!canAdd) return;
    void machine.addColumn(list, { label: name, type, choices: type === "choice" ? choicesFrom(newChoices) : [] }).then((answer) => {
      if (answer.ok) {
        setName("");
        setNewChoices("");
        setType("text");
      }
      after(answer);
    });
  };

  return (
    <div>
      <ul className="divide-y divide-line rounded-lg border-2 border-line">
        {columns.map((column, index) => {
          const isName = column.system && column.key === "name";
          return (
            <li key={column.id} className={`px-3 py-3 ${column.hidden ? "bg-hover" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  key={`${column.id}:${column.label ?? ""}`}
                  defaultValue={column.label ?? ""}
                  placeholder={column.system ? labels[column.key] : undefined}
                  aria-label={t.columnName}
                  dir="auto"
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next === (column.label ?? "")) return;
                    if (!next && !column.system) {
                      event.target.value = column.label ?? "";
                      return;
                    }
                    void machine.renameColumn(column.id, next || null).then(after);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                  }}
                  className={`min-h-[48px] min-w-0 flex-1 rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink ${
                    column.hidden ? "text-ink-3" : ""
                  }`}
                />
                <button
                  type="button"
                  aria-label={column.hidden ? t.showColumn : t.hideColumn}
                  title={column.hidden ? t.showColumn : t.hideColumn}
                  disabled={isName}
                  onClick={() => void machine.hideColumn(column.id, !column.hidden).then(after)}
                  className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-line-strong hover:bg-hover disabled:opacity-30"
                >
                  {column.hidden ? <icons.eyeOff /> : <icons.eye />}
                </button>
                <button
                  type="button"
                  aria-label={t.moveUp}
                  disabled={index === 0}
                  onClick={() => void machine.moveColumn(column.id, "up", seen).then(after)}
                  className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-line-strong hover:bg-hover disabled:opacity-30"
                >
                  <icons.up />
                </button>
                <button
                  type="button"
                  aria-label={t.moveDown}
                  disabled={index === columns.length - 1}
                  onClick={() => void machine.moveColumn(column.id, "down", seen).then(after)}
                  className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-line-strong hover:bg-hover disabled:opacity-30"
                >
                  <icons.down />
                </button>
                {!column.system ? (
                  <button
                    type="button"
                    aria-label={t.deleteColumn}
                    title={t.deleteColumn}
                    onClick={() => setDeleting(column)}
                    className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-line-strong hover:bg-hover"
                  >
                    <icons.trash />
                  </button>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-base text-ink-3">
                <span>
                  {column.system ? fill(t.columnKeepHint, { name: labels[column.key] ?? column.key }) : typeName(column.type, t)}
                  {column.hidden ? ` · ${t.hiddenColumn}` : ""}
                </span>
                {column.type === "choice" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingChoices(editingChoices === column.id ? null : column.id);
                      setChoicesText(column.choices.join("\n"));
                    }}
                    className="min-h-[44px] text-ink-2 underline underline-offset-4"
                  >
                    {column.choices.join(", ")}
                  </button>
                ) : null}
              </div>
              {editingChoices === column.id ? (
                <div className="mt-2 space-y-2">
                  <label className="block">
                    <span className="text-base text-ink-2">{t.columnChoices}</span>
                    <textarea
                      value={choicesText}
                      onChange={(event) => setChoicesText(event.target.value)}
                      rows={4}
                      dir="auto"
                      className="mt-1 w-full rounded-lg border-2 border-line-strong p-3 text-base outline-none focus:border-ink"
                    />
                    <span className="block text-base text-ink-3">{t.columnChoicesHint}</span>
                  </label>
                  <Button
                    kind="primary"
                    disabled={choicesFrom(choicesText).length === 0}
                    onClick={() =>
                      void machine.setColumnChoices(column.id, choicesFrom(choicesText)).then((answer) => {
                        if (after(answer)) setEditingChoices(null);
                      })
                    }
                  >
                    {t.save}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <h3 className="mt-6 text-lg font-semibold">{t.newColumn}</h3>
      {full ? (
        <div className="mt-2">
          <Notice text={fill(t.columnsLimit, { count: shape.limit })} />
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <Field label={t.columnName} value={name} onChange={setName} onEnter={type === "choice" ? undefined : add} />
          <div>
            <span className="text-base text-ink-2">{t.columnType}</span>
            <div className="mt-1">
              <Choices options={TYPES.map((one) => ({ value: one, label: typeName(one, t) }))} value={type} onChange={setType} />
            </div>
          </div>
          {type === "choice" ? (
            <label className="block">
              <span className="text-base text-ink-2">{t.columnChoices}</span>
              <textarea
                value={newChoices}
                onChange={(event) => setNewChoices(event.target.value)}
                rows={4}
                dir="auto"
                className="mt-1 w-full rounded-lg border-2 border-line-strong p-3 text-base outline-none focus:border-ink"
              />
              <span className="block text-base text-ink-3">{choicesFrom(newChoices).length === 0 ? t.choicesNeeded : t.columnChoicesHint}</span>
            </label>
          ) : null}
          <Button kind="primary" disabled={!canAdd} onClick={add}>
            {t.addColumn}
          </Button>
        </div>
      )}
      {problem ? (
        <div className="mt-3">
          <Notice kind="problem" text={problem} />
        </div>
      ) : null}

      {deleting ? (
        <DeleteColumn
          t={t}
          column={deleting}
          onNo={() => setDeleting(null)}
          onYes={() => {
            const id = deleting.id;
            setDeleting(null);
            void machine.deleteColumn(id).then(after);
          }}
        />
      ) : null}
    </div>
  );
}

/* Deleting takes his data with it, so he types the column's name to say he means it. */
function DeleteColumn({ t, column, onYes, onNo }: { t: ScreensCopy; column: Column; onYes: () => void; onNo: () => void }) {
  const [typed, setTyped] = useState("");
  const name = column.label ?? "";
  const same = typed.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6">
      <div className="w-full max-w-md rounded-xl bg-surface p-6 shadow-2xl" role="alertdialog" aria-label={fill(t.deleteColumnTitle, { name })}>
        <h2 className="text-xl font-semibold">{fill(t.deleteColumnTitle, { name })}</h2>
        <p className="mt-3 text-base leading-relaxed text-ink-2">{t.deleteColumnBody}</p>
        <div className="mt-4">
          <Field label={t.deleteColumnType} value={typed} onChange={setTyped} autoFocus onEnter={() => same && onYes()} />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onNo}>{t.cancel}</Button>
          <Button kind="primary" disabled={!same} onClick={onYes}>
            {t.deleteColumn}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* The owner's own columns, as fields on a product's or a customer's sheet. */
export function CustomFields({
  t,
  columns,
  values,
  errors,
  onChange,
}: {
  t: ScreensCopy;
  columns: Column[];
  values: Record<string, string>;
  errors: Record<string, string>;
  onChange: (id: string, value: string) => void;
}) {
  const own = columns.filter((column) => !column.system && !column.hidden);
  if (own.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold">{t.ownColumns}</h3>
      <div className="mt-2 space-y-3">
        {own.map((column) => {
          const label = column.label ?? "";
          const value = values[column.id] ?? "";
          switch (column.type) {
            case "yesno":
              return <Toggle key={column.id} label={label} checked={value === "1"} onChange={(yes) => onChange(column.id, yes ? "1" : "0")} />;
            case "choice":
              return (
                <label key={column.id} className="block">
                  <span className="text-base text-ink-2">{label}</span>
                  <select
                    value={value}
                    onChange={(event) => onChange(column.id, event.target.value)}
                    className="mt-1 block min-h-[48px] w-full rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink"
                  >
                    <option value="" />
                    {column.choices.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice}
                      </option>
                    ))}
                  </select>
                  {errors[column.id] ? <span className="mt-1 block text-base font-semibold">{errors[column.id]}</span> : null}
                </label>
              );
            default:
              return (
                <Field
                  key={column.id}
                  label={label}
                  value={value}
                  onChange={(next) => onChange(column.id, next)}
                  kind={column.type === "number" ? "number" : column.type === "date" ? "date" : "text"}
                  error={errors[column.id] ?? null}
                />
              );
          }
        })}
      </div>
    </div>
  );
}

/*
 * Writes what changed in his own fields, one value at a time, and answers
 * which ones were refused and why, so the sheet can say it beside the field.
 */
export async function saveCustomFields(
  list: ListName,
  rowId: string,
  t: ScreensCopy,
  before: Record<string, string>,
  after: Record<string, string>
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const [columnId, value] of Object.entries(after)) {
    if ((before[columnId] ?? "") === value) continue;
    const answer = await machine.setColumnValue(list, rowId, columnId, value);
    if (!answer.ok) errors[columnId] = answer.reason === "not a number" ? t.valueNotNumber : answer.reason === "read_only" ? t.readOnly : t.valueNotSaved;
  }
  return errors;
}

/* The Colonnes area in Settings: one list at a time, for the lists this shop has. */
export function ColumnsSettings({ configuration, t }: { configuration: Configuration; t: ScreensCopy }) {
  const lists = listsFor(configuration);
  const [list, setList] = useState<ListName>(lists[0]?.list ?? "products");
  const { shape, reload } = useListShape(list);
  const current = lists.find((one) => one.list === list);
  if (lists.length === 0 || !current) return null;
  return (
    <section>
      <h2 className="text-xl font-semibold">{t.columnsSection}</h2>
      <p className="mt-2 text-base leading-relaxed text-ink-2">{t.columnsIntro}</p>
      {lists.length > 1 ? (
        <div className="mt-3">
          <Choices
            options={lists.map((one) => ({ value: one.list, label: one.list === "products" ? t.listProducts : t.listCustomers }))}
            value={list}
            onChange={setList}
          />
        </div>
      ) : null}
      <div className="mt-3">
        {shape ? <ColumnManager list={list} t={t} labels={systemLabels(list, t)} applicable={current.applicable} shape={shape} onChanged={reload} /> : null}
      </div>
    </section>
  );
}
