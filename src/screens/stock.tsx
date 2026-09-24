import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppLanguage, Configuration } from "@app-ui/config";
import { machine, type Batch, type MovementRow, type NewProduct, type Product, type StockOverview } from "../bridge";
import { formatQuantity } from "@app-ui/format";
import { readWorkbook } from "../../vendor/ouaqt-website/builder/import/file";
import { parseProducts } from "../../vendor/ouaqt-website/builder/import/parse";
import { CustomFields, ListTable, moneyPlain, plainDay, saveCustomFields, useListShape, type SystemColumn } from "../columns";
import { fill, type ScreensCopy } from "../i18n/screens";
import {
  Button,
  Choices,
  Confirm,
  Empty,
  Field,
  Notice,
  Panel,
  ScreenHeader,
  Stat,
  Toggle,
  day,
  localDay,
  money,
  moneyText,
  parseMoney,
  parseQuantity,
  when,
} from "../ui";

/*
 * The stock, as a pharmacist looks at it: what has run out, what is running
 * low, what expires soon and what already has, before anything is clicked.
 *
 * Kept from the old pharmacy till: the four counts at the top, both names in
 * the list, the product sheet with every field it had. Changed: the quantity
 * is never typed over. Receiving, counting and writing off each write a
 * movement with its reason, so the figure on screen can always be explained.
 */

type Filter = "all" | "out" | "low" | "soon" | "expired";

/*
 * Two ways to show the same products. "stock" is the shelf: counts, batches,
 * receptions and corrections. "menu" is a restaurant's dishes or a hotel's
 * extras: names, categories and prices, sold without ever being counted.
 */
export type CatalogMode = {
  mode: "stock" | "menu";
  title?: string;
  newLabel?: string;
  /** The words for the switch that decides whether a product is counted. */
  trackLabel?: string;
  /** Batches and expiry dates, for a pharmacy. */
  batches?: boolean;
};

export function Stock({
  configuration,
  t,
  readOnly,
  catalog = { mode: "stock", batches: true },
}: {
  configuration: Configuration;
  t: ScreensCopy;
  readOnly: boolean;
  catalog?: CatalogMode;
}) {
  const language = configuration.language.app;
  const menu = catalog.mode === "menu";
  const [products, setProducts] = useState<Product[]>([]);
  const [overview, setOverview] = useState<StockOverview | null>(null);
  const [flags, setFlags] = useState<{ expired: Set<string>; expiring: Set<string> }>({ expired: new Set(), expiring: new Set() });
  const [filter, setFilter] = useState<Filter>("all");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const reload = useCallback(() => {
    void machine.products(term.trim() || undefined).then(setProducts);
    void machine.stockOverview().then((answer) => answer.ok && setOverview(answer.value));
    void machine.stockFlags().then(
      (answer) => answer.ok && setFlags({ expired: new Set(answer.value.expired), expiring: new Set(answer.value.expiring) })
    );
  }, [term]);

  useEffect(() => {
    const timer = setTimeout(reload, 120); // not-a-rule: typing delay
    return () => clearTimeout(timer);
  }, [reload]);

  const shown = useMemo(() => {
    switch (filter) {
      case "out":
        return products.filter((product) => product.onHand <= 0);
      case "low":
        return products.filter((product) => product.onHand > 0 && product.lowStock !== null && product.onHand <= product.lowStock);
      case "soon":
        return products.filter((product) => flags.expiring.has(product.id));
      case "expired":
        return products.filter((product) => flags.expired.has(product.id));
      default:
        return products;
    }
  }, [products, filter, flags]);

  const pick = (next: Filter) => setFilter((current) => (current === next ? "all" : next));

  const { shape, reload: reloadShape } = useListShape("products");
  /* The app's own columns this screen can show: a menu counts nothing, and only a pharmacy follows expiry. */
  const system = useMemo(() => {
    const columns: Record<string, SystemColumn<Product>> = {
      name: {
        label: t.colName,
        cell: (product) => (
          <>
            <div className="font-semibold">{product.name}</div>
            {product.genericName ? <div className="text-ink-3">{product.genericName}</div> : null}
          </>
        ),
        text: (product) => (product.genericName ? `${product.name} (${product.genericName})` : product.name),
        sort: (product) => product.name,
      },
      category: {
        label: t.colCategory,
        cell: (product) => <span className="text-ink-2">{product.category ?? ""}</span>,
        text: (product) => product.category ?? "",
        sort: (product) => product.category,
      },
    };
    if (!menu) {
      columns.stock = {
        label: t.colStock,
        align: "end",
        cell: (product) => (
          <bdi
            className={
              !product.tracked
                ? ""
                : product.onHand <= 0
                  ? "font-bold text-danger"
                  : product.lowStock !== null && product.onHand <= product.lowStock
                    ? "font-bold text-warning"
                    : ""
            }
          >
            {product.tracked ? product.onHand : ""}
          </bdi>
        ),
        text: (product) => (product.tracked ? formatQuantity(product.onHand, language) : ""),
        sort: (product) => (product.tracked ? product.onHand : null),
      };
    }
    columns.price = {
      label: t.colPrice,
      align: "end",
      cell: (product) => <bdi>{money(product.salePrice, language)}</bdi>,
      text: (product) => moneyPlain(product.salePrice, language),
      sort: (product) => product.salePrice,
    };
    if (catalog.batches) {
      columns.expiry = {
        label: t.colExpiry,
        align: "end",
        cell: (product) => (
          <span
            className={
              flags.expired.has(product.id) ? "font-bold text-danger" : flags.expiring.has(product.id) ? "font-bold text-warning" : "text-ink-2"
            }
          >
            {flags.expired.has(product.id) ? t.expiredOnShelf : day(product.nextExpiry, language)}
          </span>
        ),
        text: (product) => (flags.expired.has(product.id) ? t.expiredOnShelf : plainDay(product.nextExpiry, language)),
        sort: (product) => product.nextExpiry,
      };
    }
    return columns;
  }, [t, menu, catalog.batches, flags, language]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={catalog.title ?? t.stockTitle}>
        {!menu ? (
          <Button disabled={readOnly} onClick={() => setImporting(true)}>
            {t.importExcel}
          </Button>
        ) : null}
        <Button kind="primary" disabled={readOnly} onClick={() => setCreating(true)}>
          {catalog.newLabel ?? t.newProduct}
        </Button>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {overview && !menu ? (
          <div className="grid grid-cols-5 gap-3">
            <Stat label={t.products} value={String(overview.products)} onClick={() => setFilter("all")} active={filter === "all"} />
            <Stat label={t.outOfStock} value={String(overview.outOfStock)} onClick={() => pick("out")} active={filter === "out"} strong={overview.outOfStock > 0} />
            <Stat label={t.lowStock} value={String(overview.low)} onClick={() => pick("low")} active={filter === "low"} strong={overview.low > 0} />
            <Stat label={t.expiringWithin} value={String(overview.expiringSoon)} onClick={() => pick("soon")} active={filter === "soon"} strong={overview.expiringSoon > 0} />
            <Stat label={t.expired} value={String(overview.expired)} onClick={() => pick("expired")} active={filter === "expired"} strong={overview.expired > 0} />
          </div>
        ) : null}
        {overview && !menu ? (
          <p className="mt-3 text-base text-ink-3">
            {t.stockValue} : <bdi className="font-semibold text-ink">{money(overview.value, language)}</bdi>
            {overview.withoutCost > 0 ? ` · ${fill(t.withoutCost, { count: overview.withoutCost })}` : ""}
          </p>
        ) : null}

        <div className="mt-4">
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t.sellSearch}
            aria-label={t.search}
            spellCheck={false}
            className="min-h-[48px] w-full rounded-lg border-2 border-line-strong px-4 text-base outline-none focus:border-ink"
          />
        </div>

        <ListTable
          list="products"
          t={t}
          language={language}
          title={catalog.title ?? t.stockTitle}
          rows={shown}
          system={system}
          shape={shape}
          onShape={reloadShape}
          onOpen={(product) => setOpen(product.id)}
          empty={products.length === 0 && !term.trim() ? <Empty title={t.noProducts} body={t.noProductsBody} /> : <Empty title={t.noMatch} />}
        />
      </div>

      {open ? (
        <ProductPanel
          id={open}
          t={t}
          catalog={catalog}
          language={language}
          readOnly={readOnly}
          expiredIds={flags.expired}
          onClose={() => setOpen(null)}
          onChanged={() => {
            reload();
            reloadShape();
          }}
        />
      ) : null}
      {importing ? (
        <ImportPanel
          t={t}
          configuration={configuration}
          onClose={() => setImporting(false)}
          onDone={() => {
            reload();
            reloadShape();
          }}
        />
      ) : null}
      {creating ? (
        <NewProductPanel
          t={t}
          catalog={catalog}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            reload();
            reloadShape();
            setOpen(id);
          }}
        />
      ) : null}
    </div>
  );
}

type Draft = {
  name: string;
  genericName: string;
  nameArabic: string;
  category: string;
  unit: string;
  barcode: string;
  salePrice: string;
  costPrice: string;
  lowStock: string;
  tracked: boolean;
};

function draftOf(product: Product | null): Draft {
  return {
    name: product?.name ?? "",
    genericName: product?.genericName ?? "",
    nameArabic: product?.nameArabic ?? "",
    category: product?.category ?? "",
    unit: product?.unit ?? "",
    barcode: product?.barcode ?? "",
    salePrice: moneyText(product?.salePrice),
    costPrice: moneyText(product?.costPrice),
    lowStock: product?.lowStock === null || product?.lowStock === undefined ? "" : String(product.lowStock),
    tracked: product ? product.tracked : true,
  };
}

/* The product's own description as fields, and whether each one reads. */
function checkDraft(draft: Draft, t: ScreensCopy): { value: NewProduct | null; errors: Partial<Record<keyof Draft, string>> } {
  const errors: Partial<Record<keyof Draft, string>> = {};
  if (!draft.name.trim()) errors.name = t.nameNeeded;
  const sale = parseMoney(draft.salePrice);
  if (sale === null) errors.salePrice = draft.salePrice.trim() ? t.badAmount : t.priceNeeded;
  const cost = draft.costPrice.trim() ? parseMoney(draft.costPrice) : null;
  if (draft.costPrice.trim() && cost === null) errors.costPrice = t.badAmount;
  const low = draft.lowStock.trim() ? parseQuantity(draft.lowStock) : null;
  if (draft.lowStock.trim() && low === null) errors.lowStock = t.badQuantity;
  if (Object.keys(errors).length > 0) return { value: null, errors };
  return {
    value: {
      name: draft.name,
      genericName: draft.genericName,
      nameArabic: draft.nameArabic,
      category: draft.category,
      unit: draft.unit,
      barcode: draft.barcode,
      salePrice: sale as number,
      costPrice: cost,
      lowStock: low,
      tracked: draft.tracked,
    },
    errors,
  };
}

function ProductFields({
  draft,
  setDraft,
  errors,
  t,
  catalog,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  errors: Partial<Record<keyof Draft, string>>;
  t: ScreensCopy;
  catalog: CatalogMode;
}) {
  const set = (key: Exclude<keyof Draft, "tracked">) => (value: string) => setDraft({ ...draft, [key]: value });
  const menu = catalog.mode === "menu";
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Field label={t.name} value={draft.name} onChange={set("name")} error={errors.name} autoFocus />
      </div>
      {catalog.batches ? <Field label={t.genericName} value={draft.genericName} onChange={set("genericName")} /> : null}
      <Field label={t.nameArabic} value={draft.nameArabic} onChange={set("nameArabic")} />
      <Field label={t.category} value={draft.category} onChange={set("category")} />
      {!menu ? <Field label={t.unit} value={draft.unit} onChange={set("unit")} hint={t.unitHint} /> : null}
      <Field label={t.salePrice} value={draft.salePrice} onChange={set("salePrice")} kind="amount" error={errors.salePrice} />
      <Field label={t.costPrice} value={draft.costPrice} onChange={set("costPrice")} kind="amount" error={errors.costPrice} />
      {!menu && draft.tracked ? (
        <Field label={t.lowStockAt} value={draft.lowStock} onChange={set("lowStock")} kind="number" hint={t.lowStockHint} error={errors.lowStock} />
      ) : null}
      {!menu ? <Field label={t.barcode} value={draft.barcode} onChange={set("barcode")} ltr /> : null}
      {catalog.trackLabel ? (
        <div className="col-span-2">
          <Toggle label={catalog.trackLabel} checked={draft.tracked} onChange={(tracked) => setDraft({ ...draft, tracked })} />
        </div>
      ) : null}
    </div>
  );
}

function NewProductPanel({
  t,
  catalog,
  onClose,
  onCreated,
}: {
  t: ScreensCopy;
  catalog: CatalogMode;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const menu = catalog.mode === "menu";
  const [draft, setDraft] = useState<Draft>({ ...draftOf(null), tracked: !menu });
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [opening, setOpening] = useState("");
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { shape } = useListShape("products");
  const [custom, setCustom] = useState<Record<string, string>>({});

  async function save() {
    const checked = checkDraft(draft, t);
    setErrors(checked.errors);
    const quantity = opening.trim() ? parseQuantity(opening) : null;
    if (!checked.value || (opening.trim() && quantity === null)) return;
    setBusy(true);
    const added = await machine.addProduct(checked.value);
    if (!added.ok) {
      setBusy(false);
      setProblem(added.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    if (quantity !== null && quantity > 0) {
      await machine.receiveStock({
        productId: added.value,
        quantity,
        lot: lot || null,
        expiresOn: expiry || null,
        costPrice: checked.value.costPrice ?? null,
      });
    }
    /* The product exists now; a value of his own that is refused is said on its sheet, which opens next. */
    await saveCustomFields("products", added.value, t, {}, custom);
    setBusy(false);
    onCreated(added.value);
  }

  return (
    <Panel
      title={catalog.newLabel ?? t.newProduct}
      onClose={onClose}
      closeLabel={t.close}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t.cancel}</Button>
          <Button kind="primary" disabled={busy} onClick={() => void save()}>
            {t.save}
          </Button>
        </div>
      }
    >
      <ProductFields draft={draft} setDraft={setDraft} errors={errors} t={t} catalog={catalog} />
      {!menu && draft.tracked ? (
        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-5">
          <Field label={t.openingStock} value={opening} onChange={setOpening} kind="number" error={opening.trim() && parseQuantity(opening) === null ? t.badQuantity : null} />
          {catalog.batches ? <Field label={t.lot} value={lot} onChange={setLot} ltr /> : null}
          {catalog.batches ? <Field label={t.expiryDate} value={expiry} onChange={setExpiry} kind="date" /> : null}
        </div>
      ) : null}
      <CustomFields
        t={t}
        columns={shape?.columns ?? []}
        values={custom}
        errors={{}}
        onChange={(column, value) => setCustom((current) => ({ ...current, [column]: value }))}
      />
      {problem ? <div className="mt-4"><Notice kind="problem" text={problem} /></div> : null}
    </Panel>
  );
}

type Tab = "details" | "batches" | "history";

function ProductPanel({
  id,
  t,
  catalog,
  language,
  readOnly,
  expiredIds,
  onClose,
  onChanged,
}: {
  id: string;
  t: ScreensCopy;
  catalog: CatalogMode;
  language: AppLanguage;
  readOnly: boolean;
  expiredIds: Set<string>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [draft, setDraft] = useState<Draft>(draftOf(null));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [tab, setTab] = useState<Tab>("details");
  const [action, setAction] = useState<"receive" | "count" | null>(null);
  const [writeOff, setWriteOff] = useState<Batch | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const { shape, reload: reloadCustom } = useListShape("products");
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (shape) setCustom(shape.values[id] ?? {});
  }, [shape, id]);

  const load = useCallback(() => {
    void machine.productDetail(id).then((answer) => {
      if (!answer.ok) return;
      setProduct(answer.value.product);
      setBatches(answer.value.batches);
      setMovements(answer.value.movements);
      setDraft(draftOf(answer.value.product));
    });
  }, [id]);

  useEffect(load, [load]);

  const after = (ok: boolean, reason?: string) => {
    if (ok) {
      setNote({ text: t.saved, kind: "done" });
      load();
      onChanged();
    } else {
      setNote({ text: reason === "read_only" ? t.readOnly : t.notSaved, kind: "problem" });
    }
  };

  async function saveDetails() {
    const checked = checkDraft(draft, t);
    setErrors(checked.errors);
    if (!checked.value) return;
    const answer = await machine.updateProduct(id, checked.value);
    if (!answer.ok) return after(false, answer.reason);
    const refused = await saveCustomFields("products", id, t, shape?.values[id] ?? {}, custom);
    setCustomErrors(refused);
    reloadCustom();
    if (Object.keys(refused).length === 0) return after(true);
    setNote({ text: t.valueNotSaved, kind: "problem" });
    load();
    onChanged();
  }

  if (!product) return null;
  const today = localDay();
  const counted = catalog.mode !== "menu" && product.tracked;

  return (
    <Panel
      title={product.name}
      onClose={onClose}
      closeLabel={t.close}
      footer={
        tab === "details" ? (
          <div className="flex items-center justify-between gap-2">
            <Button kind="quiet" disabled={readOnly} onClick={() => setArchiving(true)}>
              {t.archive}
            </Button>
            <Button kind="primary" disabled={readOnly} onClick={() => void saveDetails()}>
              {t.save}
            </Button>
          </div>
        ) : null
      }
    >
      {counted ? (
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-base text-ink-3">{t.colStock}</div>
          <div className="text-4xl font-bold">
            <bdi>{product.onHand}</bdi>
            {product.unit ? <span className="ms-2 text-xl font-normal text-ink-3">{product.unit}</span> : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Button disabled={readOnly} onClick={() => setAction("count")}>
            {t.count}
          </Button>
          <Button kind="primary" disabled={readOnly} onClick={() => setAction("receive")}>
            {t.receive}
          </Button>
        </div>
      </div>
      ) : null}
      {expiredIds.has(product.id) ? <div className="mt-3"><Notice kind="problem" text={t.expiredOnShelf} /></div> : null}

      {counted ? (
        <div className="mt-5">
          <Choices<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "details", label: t.details },
              ...(catalog.batches ? [{ value: "batches" as const, label: t.batches, count: batches.length }] : []),
              { value: "history", label: t.history },
            ]}
          />
        </div>
      ) : null}

      {note ? <div className="mt-4"><Notice kind={note.kind} text={note.text} /></div> : null}

      <div className="mt-5">
        {tab === "details" ? (
          <>
            <ProductFields draft={draft} setDraft={setDraft} errors={errors} t={t} catalog={catalog} />
            <CustomFields
              t={t}
              columns={shape?.columns ?? []}
              values={custom}
              errors={customErrors}
              onChange={(column, value) => setCustom((current) => ({ ...current, [column]: value }))}
            />
          </>
        ) : null}

        {tab === "batches" ? (
          batches.length === 0 ? (
            <p className="text-base text-ink-3">{t.noBatches}</p>
          ) : (
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-line text-ink-3">
                  <th className="py-2 text-start font-normal">{t.lot}</th>
                  <th className="py-2 text-start font-normal">{t.colExpiry}</th>
                  <th className="py-2 text-end font-normal">{t.remaining}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const isExpired = batch.expiresOn !== null && batch.expiresOn < today;
                  return (
                    <tr key={batch.id} className="border-b border-line">
                      <td className="py-3"><bdi>{batch.lot ?? ""}</bdi></td>
                      <td className={`py-3 ${isExpired ? "font-bold" : ""}`}>
                        {day(batch.expiresOn, language)}
                        {isExpired ? ` · ${t.expiredOnShelf}` : ""}
                      </td>
                      <td className="py-3 text-end"><bdi>{batch.remaining}</bdi></td>
                      <td className="py-3 text-end">
                        <Button kind={isExpired ? "danger" : "quiet"} disabled={readOnly} onClick={() => setWriteOff(batch)}>
                          {t.writeOff}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : null}

        {tab === "history" ? (
          movements.length === 0 ? (
            <p className="text-base text-ink-3">{t.noHistory}</p>
          ) : (
            <ul>
              {movements.map((move) => (
                <li key={move.id} className="flex items-center justify-between gap-3 border-b border-line py-3">
                  <span>
                    <span className="block text-base">{movementLabel(move, t)}</span>
                    <span className="block text-base text-ink-3">
                      <bdi>{when(move.occurredAt, language)}</bdi>
                      {move.lot ? <> · {t.lot} <bdi>{move.lot}</bdi></> : null}
                      {move.reference ? ` · ${move.reference}` : ""}
                    </span>
                  </span>
                  <bdi className="text-lg font-semibold">{move.quantity > 0 ? `+${move.quantity}` : move.quantity}</bdi>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      {action === "receive" ? (
        <ReceiveDialog
          t={t}
          batches={Boolean(catalog.batches)}
          product={product}
          onDone={(ok, reason) => {
            setAction(null);
            if (ok !== null) after(ok, reason);
          }}
        />
      ) : null}
      {action === "count" ? (
        <CountDialog
          t={t}
          product={product}
          onDone={(ok, reason) => {
            setAction(null);
            if (ok !== null) after(ok, reason);
          }}
        />
      ) : null}
      {writeOff ? (
        <Confirm
          title={t.writeOff}
          body={fill(t.writeOffBody, { count: writeOff.remaining, lot: writeOff.lot ?? "" })}
          yes={t.writeOff}
          no={t.cancel}
          onNo={() => setWriteOff(null)}
          onYes={() => {
            const batch = writeOff;
            setWriteOff(null);
            void machine
              .adjustStock({ productId: product.id, out: batch.remaining, reason: "expiry", batchId: batch.id })
              .then((answer) => after(answer.ok, answer.ok ? undefined : answer.reason));
          }}
        />
      ) : null}
      {archiving ? (
        <Confirm
          title={t.archive}
          body={t.archiveBody}
          yes={t.archive}
          no={t.cancel}
          onNo={() => setArchiving(false)}
          onYes={() => {
            setArchiving(false);
            void machine.archiveProduct(product.id).then((answer) => {
              if (answer.ok) {
                onChanged();
                onClose();
              } else after(false, answer.reason);
            });
          }}
        />
      ) : null}
    </Panel>
  );
}

function movementLabel(move: MovementRow, t: ScreensCopy): string {
  switch (move.reason) {
    case "sale":
      return fill(t.moveSale, { number: move.saleNumber ?? "" });
    case "return":
      return t.moveReturn;
    case "reception":
      return move.opening ? t.moveOpening : t.moveReception;
    case "expiry":
      return t.moveExpiry;
    default:
      return t.moveAdjustment;
  }
}

function ReceiveDialog({
  t,
  batches,
  product,
  onDone,
}: {
  t: ScreensCopy;
  batches: boolean;
  product: Product;
  onDone: (ok: boolean | null, reason?: string) => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cost, setCost] = useState(moneyText(product.costPrice));
  const [supplier, setSupplier] = useState("");
  const parsed = parseQuantity(quantity);
  const costMinor = cost.trim() ? parseMoney(cost) : null;
  const valid = parsed !== null && parsed > 0 && (!cost.trim() || costMinor !== null);

  return (
    <Confirm
      title={t.receiveTitle}
      yes={t.save}
      no={t.cancel}
      onNo={() => onDone(null)}
      onYes={() => {
        if (!valid) return;
        void machine
          .receiveStock({
            productId: product.id,
            quantity: parsed as number,
            lot: lot || null,
            expiresOn: expiry || null,
            costPrice: costMinor,
            supplierName: supplier || null,
          })
          .then((answer) => onDone(answer.ok, answer.ok ? undefined : answer.reason));
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.quantity} value={quantity} onChange={setQuantity} kind="number" autoFocus error={quantity.trim() && !parsed ? t.badQuantity : null} />
        <Field label={t.costPrice} value={cost} onChange={setCost} kind="amount" error={cost.trim() && costMinor === null ? t.badAmount : null} />
        {batches ? <Field label={t.lot} value={lot} onChange={setLot} ltr /> : null}
        {batches ? <Field label={t.expiryDate} value={expiry} onChange={setExpiry} kind="date" /> : null}
        <div className="col-span-2">
          <Field label={t.supplier} value={supplier} onChange={setSupplier} />
        </div>
      </div>
    </Confirm>
  );
}

function CountDialog({
  t,
  product,
  onDone,
}: {
  t: ScreensCopy;
  product: Product;
  onDone: (ok: boolean | null, reason?: string) => void;
}) {
  const [counted, setCounted] = useState("");
  const reasons = [t.reasonCount, t.reasonBroken, t.reasonOther];
  const [reason, setReason] = useState(reasons[0]);
  const parsed = parseQuantity(counted);

  return (
    <Confirm
      title={t.countTitle}
      body={fill(t.countHint, { count: product.onHand })}
      yes={t.save}
      no={t.cancel}
      onNo={() => onDone(null)}
      onYes={() => {
        if (parsed === null) return;
        void machine
          .adjustStock({ productId: product.id, counted: parsed, reason: "adjustment", note: reason })
          .then((answer) => onDone(answer.ok, answer.ok ? undefined : answer.reason));
      }}
    >
      <div className="space-y-3">
        <Field label={t.counted} value={counted} onChange={setCounted} kind="number" autoFocus error={counted.trim() && parsed === null ? t.badQuantity : null} />
        <div>
          <div className="mb-1 text-base text-ink-2">{t.reason}</div>
          <Choices<string> value={reason} onChange={setReason} options={reasons.map((one) => ({ value: one, label: one }))} />
        </div>
      </div>
    </Confirm>
  );
}

/*
 * A spreadsheet of products brought in, read by the same rules as the
 * website's builder: it finds the columns, reads the prices, the quantities
 * and the dates, and says which rows it could not read and why, before
 * anything is added. Prices that look like old ouguiyas are asked about.
 */
function ImportPanel({ t, configuration, onClose, onDone }: { t: ScreensCopy; configuration: Configuration; onClose: () => void; onDone: () => void }) {
  const pack = configuration.pack;
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [currency, setCurrency] = useState<"new" | "old">("new");
  const [reading, setReading] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const result = useMemo(() => (rows ? parseProducts(rows, pack, { currency }) : null), [rows, pack, currency]);

  async function pick(file: File) {
    setReading(true);
    setUnreadable(false);
    setDone(null);
    try {
      const workbook = await readWorkbook(file, pack);
      const best = workbook.sheets[0]?.name;
      setRows(best ? workbook.rows[best] : []);
      setCurrency("new");
    } catch {
      setUnreadable(true);
      setRows(null);
    } finally {
      setReading(false);
    }
  }

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
    if (!result || result.products.length === 0) return;
    setBusy(true);
    const answer = await machine.importProducts(
      result.products.map((product) => ({
        name: product.name,
        price: product.price,
        quantity: product.quantity,
        barcode: product.barcode ?? null,
        expiry: product.expiry ?? null,
        batch: product.batch ?? null,
        unit: product.unit ?? null,
      }))
    );
    setBusy(false);
    if (!answer.ok) {
      setDone(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    setDone(fill(t.importDone, { added: answer.value.added, skipped: answer.value.skipped.length }));
    setRows(null);
    onDone();
  }

  return (
    <Panel
      title={t.importTitle}
      onClose={onClose}
      closeLabel={t.close}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t.close}</Button>
          <Button kind="primary" disabled={!result || result.products.length === 0 || busy} onClick={() => void save()}>
            {fill(t.importGo, { count: result?.products.length ?? 0 })}
          </Button>
        </div>
      }
    >
      <label className="flex min-h-[56px] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-line-strong px-4 text-base font-semibold hover:bg-hover">
        {reading ? t.importReading : t.importPick}
        <input
          type="file"
          accept=".xlsx,.xls,.csv,.ods"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void pick(file);
          }}
        />
      </label>
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
      {result ? (
        <div className="mt-4 space-y-3 text-base">
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
            <table className="w-full">
              <tbody>
                {result.products.slice(0, 8).map((product) => (
                  <tr key={product.row} className="border-b border-line">
                    <td className="py-1.5 pe-2">{product.name}</td>
                    <td className="py-1.5 text-end">
                      <bdi>{product.quantity}</bdi>
                    </td>
                    <td className="py-1.5 text-end">
                      <bdi>{moneyText(product.price)}</bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

