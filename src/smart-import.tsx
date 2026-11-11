import { useEffect, useMemo, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { readWorkbook } from "../vendor/ouaqt-website/builder/import/file";
import { parseProducts } from "../vendor/ouaqt-website/builder/import/parse";
import { machine, type ImportedSale, type SalesImportCheck } from "./bridge";
import { kindOf, parseSales, sheetFor, type FileKind, type SalesField, type SalesProblemCode } from "./import/sales";
import { fill, type ScreensCopy } from "./i18n/screens";
import { statisticsFor } from "./i18n/statistics";
import { Button, Choices, Notice, Panel, Toggle, day, money } from "./ui";
import { dayKey } from "./periods";

/*
 * One way in for any spreadsheet: it is read on this device, recognised as a
 * book of sales or a list of products, and shown back before anything is
 * written.
 *
 * Sales join the ones already recorded, each on its own day, and the
 * database leaves out what is already there: a row imported before, a day
 * OUAQT already recorded. Products join the stock, and one already there is
 * updated or left alone, as the owner chooses.
 */

type Kind = Exclude<FileKind, "unknown">;

export function SmartImport({
  configuration,
  t,
  allowProducts,
  prefer,
  onClose,
  onDone,
}: {
  configuration: Configuration;
  t: ScreensCopy;
  /** False in a trade with no product list to fill. */
  allowProducts: boolean;
  /** What to read the file as when it could be either. */
  prefer: Kind;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const pack = configuration.pack;
  const language = configuration.language.app;
  const st = statisticsFor(language);
  const [file, setFile] = useState<{ name: string; sheets: Record<string, unknown[][]> } | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [kind, setKind] = useState<FileKind>("unknown");
  const [reading, setReading] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function pick(chosen: File) {
    setReading(true);
    setUnreadable(false);
    setDone(null);
    try {
      const workbook = await readWorkbook(chosen, pack);
      const sheets = workbook.rows;
      const salesSheet = sheetFor(sheets, "sales", pack);
      const productSheet = allowProducts ? sheetFor(sheets, "products", pack) : null;
      const both = salesSheet && productSheet;
      const next: FileKind = both ? prefer : salesSheet ? "sales" : productSheet ? "products" : "unknown";
      setFile({ name: chosen.name, sheets });
      setKind(next);
      setSheet((next === "sales" ? salesSheet : next === "products" ? productSheet : null) ?? workbook.sheets[0]?.name ?? null);
    } catch {
      setUnreadable(true);
      setFile(null);
    } finally {
      setReading(false);
    }
  }

  const rows = file && sheet ? (file.sheets[sheet] ?? []) : null;
  const sheetNames = file ? Object.keys(file.sheets) : [];

  /* Turning to the other kind, or to another sheet, reads that sheet again as asked. */
  function choose(next: Kind) {
    setKind(next);
    if (file) setSheet(sheetFor(file.sheets, next, pack) ?? sheet);
  }

  return (
    <Panel title={st.importAnyTitle} onClose={onClose} closeLabel={t.close}>
      <label className="flex min-h-[64px] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-line-strong px-4 text-center text-base font-semibold hover:bg-hover">
        {reading ? t.importReading : file ? file.name : allowProducts ? st.importPickAny : t.importPick}
        <input
          type="file"
          accept=".xlsx,.xls,.csv,.ods"
          className="sr-only"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (chosen) void pick(chosen);
          }}
        />
      </label>
      {!file && !reading ? <p className="mt-3 text-base text-ink-3">{st.importHelp}</p> : null}
      {unreadable ? (
        <div className="mt-3">
          <Notice kind="problem" text={t.importUnreadable} />
        </div>
      ) : null}
      {done ? (
        <div className="mt-3">
          <Notice kind="done" text={done} />
        </div>
      ) : null}

      {file && rows ? (
        <div className="mt-4 space-y-4 text-base">
          {allowProducts ? (
            <div>
              <div className="mb-2 text-ink-3">{st.importKindQuestion}</div>
              <Choices<Kind>
                value={kind === "products" ? "products" : "sales"}
                onChange={choose}
                options={[
                  { value: "sales", label: st.importKindSales },
                  { value: "products", label: st.importKindProducts },
                ]}
              />
            </div>
          ) : null}
          {sheetNames.length > 1 ? (
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-ink-3">{st.importSheet}</span>
              <select
                value={sheet ?? ""}
                onChange={(event) => setSheet(event.target.value)}
                className="min-h-[48px] rounded-lg border-2 border-line-strong bg-surface px-3 text-base text-ink"
              >
                {sheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {kind === "unknown" && kindOf(rows, pack) === "unknown" ? <Notice kind="problem" text={st.importUnknownKind} /> : null}
          {kind === "sales" || (kind === "unknown" && !allowProducts) ? (
            <SalesPart
              key={`${file.name}/${sheet}`}
              rows={rows}
              fileName={file.name}
              configuration={configuration}
              t={t}
              onDone={(message) => {
                setDone(message);
                setFile(null);
                onDone(message);
              }}
            />
          ) : null}
          {kind === "products" ? (
            <ProductsPart
              key={`${file.name}/${sheet}`}
              rows={rows}
              configuration={configuration}
              t={t}
              onDone={(message) => {
                setDone(message);
                setFile(null);
                onDone(message);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function ColumnsRead({ columns, labels }: { columns: Partial<Record<string, { header: string }>>; labels: Record<string, string> }) {
  const found = Object.entries(labels).filter(([field]) => columns[field]);
  if (found.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {found.map(([field, label]) => (
        <li key={field} className="rounded-full border border-line px-3 py-1 text-[15px]">
          <span className="font-semibold">{label}</span> <span className="text-ink-3">← « {columns[field]!.header} »</span>
        </li>
      ))}
    </ul>
  );
}

function SalesPart({
  rows,
  fileName,
  configuration,
  t,
  onDone,
}: {
  rows: unknown[][];
  fileName: string;
  configuration: Configuration;
  t: ScreensCopy;
  onDone: (message: string) => void;
}) {
  const language = configuration.language.app;
  const st = statisticsFor(language);
  const [currency, setCurrency] = useState<"new" | "old" | undefined>(undefined);
  const [pickedDay, setPickedDay] = useState<string>(() => dayKey(new Date()));
  const [check, setCheck] = useState<SalesImportCheck | null>(null);
  const [includeOwnDays, setIncludeOwnDays] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const first = useMemo(() => parseSales(rows, { pack: configuration.pack }), [rows, configuration.pack]);
  const read = useMemo(
    () => parseSales(rows, { pack: configuration.pack, currency: currency ?? (first.currency.ask ? "new" : undefined), day: first.needsDay ? pickedDay : null }),
    [rows, configuration.pack, currency, first.currency.ask, first.needsDay, pickedDay]
  );
  /* A line with no name still says what it was. */
  const sales: ImportedSale[] = useMemo(
    () => read.sales.map((sale) => ({ ...sale, lines: sale.lines.map((line) => ({ ...line, label: line.label ?? st.importedLabel })) })),
    [read.sales, st.importedLabel]
  );

  useEffect(() => {
    setCheck(null);
    if (sales.length === 0) return;
    let live = true;
    void machine.checkSalesImport(sales).then((answer) => live && answer.ok && setCheck(answer.value));
    return () => {
      live = false;
    };
  }, [sales]);

  const problemWords: Record<SalesProblemCode, string> = {
    bad_date: st.importBadDate,
    no_amount: st.importNoAmount,
    bad_amount: st.importBadAmount,
    negative_amount: st.importNegativeAmount,
    bad_quantity: t.importBadQuantity,
  };
  const labels: Record<SalesField, string> = {
    date: st.fieldDate,
    time: st.fieldTime,
    ticket: st.fieldTicket,
    name: st.fieldName,
    quantity: st.fieldQuantity,
    unitPrice: st.fieldUnitPrice,
    total: st.fieldTotal,
    payment: st.fieldPayment,
  };

  const willAdd = check ? (includeOwnDays ? check.fresh : check.fresh - check.onOwnDays) : 0;
  const willTotal = check ? (includeOwnDays ? check.freshTotal : check.freshTotalWithoutOwnDays) : 0;

  async function save() {
    setBusy(true);
    setFailed(null);
    const answer = await machine.importSales({ sales, fileName, includeOwnDays });
    setBusy(false);
    if (!answer.ok) {
      setFailed(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    const result = answer.value;
    onDone(
      result.added === 0
        ? st.importNothingNew
        : fill(st.importSalesDone, {
            count: result.added,
            amount: money(result.total, language),
            from: day(result.firstDay, language),
            to: day(result.lastDay, language),
          })
    );
  }

  return (
    <div className="space-y-4">
      <ColumnsRead columns={read.columns} labels={labels} />

      {first.currency.ask ? (
        <div className="rounded-lg border-2 border-warning bg-warning-soft p-3">
          <p className="font-semibold">{t.importOldMoney}</p>
          <div className="mt-2">
            <Choices<"new" | "old">
              value={currency ?? "new"}
              onChange={setCurrency}
              options={[
                { value: "new", label: t.currencyNew },
                { value: "old", label: t.currencyOld },
              ]}
            />
          </div>
        </div>
      ) : null}

      {first.needsDay ? (
        <label className="block">
          <span className="font-semibold">{st.importWhichDay}</span>
          <input
            type="date"
            dir="ltr"
            max={dayKey(new Date())}
            value={pickedDay}
            onChange={(event) => setPickedDay(event.target.value)}
            className="mt-2 block min-h-[48px] rounded-lg border-2 border-line-strong bg-surface px-3 text-base text-ink outline-none focus:border-ink"
          />
        </label>
      ) : null}

      {read.sales.length > 0 ? (
        <div>
          <p className="text-lg font-semibold">
            {fill(st.importSalesFound, { count: read.sales.length, from: day(read.firstDay, language), to: day(read.lastDay, language) })}
          </p>
          <p className="text-ink-2">{fill(st.importSalesTotal, { amount: money(read.total, language) })}</p>
        </div>
      ) : null}

      {read.problems.length > 0 ? (
        <div>
          <p className="font-semibold text-danger">{fill(st.importSalesProblems, { count: read.problems.length })}</p>
          <ul className="mt-1 text-ink-2">
            {read.problems.slice(0, 8).map((problem, index) => (
              <li key={index}>
                {fill(t.importProblemRow, { row: problem.row, what: problemWords[problem.code] })}
                {problem.found ? <span className="text-ink-3"> (« {problem.found} »)</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {read.sales.length > 0 ? (
        <div className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4">
          <table className="w-full max-md:w-max max-md:min-w-full max-md:[&_td]:pe-4">
            <tbody>
              {read.sales.slice(0, 6).map((sale) => (
                <tr key={sale.key} className="border-b border-line">
                  <td className="py-1.5 pe-2">
                    <bdi>{day(sale.day, language)}</bdi>
                  </td>
                  <td className="py-1.5 pe-2">{sale.lines.map((line) => line.label ?? st.importedLabel).join(", ")}</td>
                  <td className="py-1.5 text-end">
                    <bdi>{money(sale.lines.reduce((sum, line) => sum + line.total, 0), language)}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {read.sales.length > 0 && !check ? <p className="text-ink-3">{st.importChecking}</p> : null}
      {check ? (
        <div className="space-y-2">
          {check.already > 0 ? <p className="text-ink-2">{fill(st.importAlready, { count: check.already })}</p> : null}
          {check.ownDays.length > 0 ? (
            <div className="rounded-lg border-2 border-line-strong p-3">
              <p>{fill(st.importOwnDays, { days: check.ownDays.length, count: check.onOwnDays })}</p>
              <div className="mt-2">
                <Toggle label={st.importOwnDaysToo} checked={includeOwnDays} onChange={setIncludeOwnDays} />
              </div>
            </div>
          ) : null}
          {willAdd === 0 ? <Notice kind="info" text={st.importNothingNew} /> : null}
        </div>
      ) : null}

      {failed ? <Notice kind="problem" text={failed} /> : null}

      <div className="flex justify-end">
        <Button kind="primary" big disabled={busy || !check || willAdd === 0} onClick={() => void save()}>
          {fill(st.importSalesGo, { count: willAdd, amount: money(willTotal, language) })}
        </Button>
      </div>
    </div>
  );
}

function ProductsPart({
  rows,
  configuration,
  t,
  onDone,
}: {
  rows: unknown[][];
  configuration: Configuration;
  t: ScreensCopy;
  onDone: (message: string) => void;
}) {
  const language = configuration.language.app;
  const st = statisticsFor(language);
  const [currency, setCurrency] = useState<"new" | "old">("new");
  const [existing, setExisting] = useState<"update" | "keep">("update");
  const [known, setKnown] = useState<{ names: Set<string>; barcodes: Set<string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const result = useMemo(() => parseProducts(rows, configuration.pack, { currency }), [rows, configuration.pack, currency]);

  useEffect(() => {
    void machine.products().then((all) =>
      setKnown({
        names: new Set(all.flatMap((product) => [product.name, product.nameArabic ?? ""]).map((name) => name.trim().toLowerCase()).filter(Boolean)),
        barcodes: new Set(all.map((product) => product.barcode ?? "").filter(Boolean)),
      })
    );
  }, []);

  const already = known
    ? result.products.filter((product) => (product.barcode && known.barcodes.has(product.barcode)) || known.names.has(product.name.trim().toLowerCase())).length
    : 0;

  const problemWords: Record<string, string> = {
    missing_name: t.importMissingName,
    missing_price: t.importMissingPrice,
    bad_price: t.importBadPrice,
    zero_price: t.importZeroPrice,
    negative_price: t.importNegativePrice,
    bad_quantity: t.importBadQuantity,
    bad_expiry: t.importBadExpiry,
  };

  async function save() {
    setBusy(true);
    setFailed(null);
    const answer = await machine.importProducts(
      result.products.map((product) => ({
        name: product.name,
        price: product.price,
        quantity: product.quantity,
        barcode: product.barcode ?? null,
        expiry: product.expiry ?? null,
        batch: product.batch ?? null,
        unit: product.unit ?? null,
      })),
      { existing, counted: Boolean(result.columns.quantity) }
    );
    setBusy(false);
    if (!answer.ok) {
      setFailed(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    const value = answer.value;
    onDone(fill(st.importProductsDone, { added: value.added, updated: value.updated, same: value.unchanged + value.skipped.length }));
  }

  return (
    <div className="space-y-4">
      {result.currency.ask ? (
        <div className="rounded-lg border-2 border-warning bg-warning-soft p-3">
          <p className="font-semibold">{t.importOldMoney}</p>
          <div className="mt-2">
            <Choices<"new" | "old">
              value={currency}
              onChange={setCurrency}
              options={[
                { value: "new", label: t.currencyNew },
                { value: "old", label: t.currencyOld },
              ]}
            />
          </div>
        </div>
      ) : null}
      <p className="text-lg font-semibold">{fill(t.importReady, { count: result.products.length })}</p>
      {result.warnings.length > 0 ? <p className="text-warning">{fill(t.importPastExpiry, { count: result.warnings.length })}</p> : null}
      {already > 0 ? (
        <div className="rounded-lg border-2 border-line-strong p-3">
          <p className="mb-2 font-semibold">{fill(st.importExisting, { count: already })}</p>
          <Choices<"update" | "keep">
            value={existing}
            onChange={setExisting}
            options={[
              { value: "update", label: st.importExistingUpdate },
              { value: "keep", label: st.importExistingKeep },
            ]}
          />
        </div>
      ) : null}
      {result.problems.length > 0 ? (
        <div>
          <p className="font-semibold text-danger">{fill(t.importProblems, { count: result.problems.length })}</p>
          <ul className="mt-1 text-ink-2">
            {result.problems.slice(0, 12).map((problem, index) => (
              <li key={index}>{fill(t.importProblemRow, { row: problem.row, what: problemWords[problem.code] ?? problem.code })}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.products.length > 0 ? (
        <div className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4">
          <table className="w-full max-md:w-max max-md:min-w-full max-md:[&_td]:pe-4">
            <tbody>
              {result.products.slice(0, 8).map((product) => (
                <tr key={product.row} className="border-b border-line">
                  <td className="py-1.5 pe-2">{product.name}</td>
                  <td className="py-1.5 text-end">
                    <bdi>{product.quantity}</bdi>
                  </td>
                  <td className="py-1.5 text-end">
                    <bdi>{money(product.price, language)}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {failed ? <Notice kind="problem" text={failed} /> : null}
      <div className="flex justify-end">
        <Button kind="primary" big disabled={busy || result.products.length === 0} onClick={() => void save()}>
          {fill(st.importProductsGo, { count: result.products.length })}
        </Button>
      </div>
    </div>
  );
}
