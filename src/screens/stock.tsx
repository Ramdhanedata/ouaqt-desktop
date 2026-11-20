import { useCallback, useEffect, useMemo, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type Product, type StockOverview } from "../bridge";
import { formatQuantity } from "@app-ui/format";
import { SmartImport } from "../smart-import";
import { ListTable, moneyPlain, plainDay, useListShape, type SystemColumn } from "../columns";
import { productProfile } from "../i18n/products";
import { fill, type ScreensCopy } from "../i18n/screens";
import { Button, Empty, ScreenHeader, day, money, useDataTick } from "../ui";
import { icons } from "../icons";
import { type CatalogMode } from "./stock-shared";
import { NewProductPanel, ProductPanel } from "./stock-product";

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

export function Stock({
  configuration,
  t,
  readOnly,
  catalog: given = { mode: "stock" },
}: {
  configuration: Configuration;
  t: ScreensCopy;
  readOnly: boolean;
  catalog?: CatalogMode;
}) {
  const language = configuration.language.app;
  /*
   * What this trade calls a product and which fields it has: a DCI and lots
   * for a pharmacy, a reference for a warehouse, a dish for a restaurant.
   */
  const profile = useMemo(() => productProfile(configuration), [configuration]);
  const catalog: CatalogMode = useMemo(
    () => ({ ...given, batches: given.mode === "stock" && profile.batches, profile }),
    [given, profile]
  );
  const menu = catalog.mode === "menu";
  const [products, setProducts] = useState<Product[]>([]);
  const [overview, setOverview] = useState<StockOverview | null>(null);
  const [flags, setFlags] = useState<{ expired: Set<string>; expiring: Set<string> }>({ expired: new Set(), expiring: new Set() });
  const [filter, setFilter] = useState<Filter>("all");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const dataTick = useDataTick();
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
  }, [reload, dataTick]);

  const filters = useMemo(() => {
    if (!overview || menu) return [];
    const all: { value: Filter; label: string; count: number; warn?: boolean }[] = [
      { value: "all", label: t.products, count: overview.products },
      { value: "out", label: t.outOfStock, count: overview.outOfStock, warn: true },
      { value: "low", label: t.lowStock, count: overview.low, warn: true },
      /* Expiry is a pharmacy's worry; the other trades are not asked to read it. */
      ...(catalog.batches
        ? [
            { value: "soon" as const, label: t.expiringWithin, count: overview.expiringSoon, warn: true },
            { value: "expired" as const, label: t.expired, count: overview.expired, warn: true },
          ]
        : []),
    ];
    return all.filter((one) => one.value === "all" || one.count > 0);
  }, [overview, menu, catalog.batches, t]);
  /* A chip that has emptied since it was pressed is gone: the list goes back to everything. */
  const activeFilter: Filter = filters.some((one) => one.value === filter) ? filter : "all";

  const shown = useMemo(() => {
    switch (activeFilter) {
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
  }, [products, activeFilter, flags]);

  const pick = (next: Filter) => setFilter((current) => (current === next ? "all" : next));

  const { shape, reload: reloadShape } = useListShape("products");
  /* The app's own columns this screen can show: a menu counts nothing, and only a pharmacy follows expiry. */
  const system = useMemo(() => {
    const columns: Record<string, SystemColumn<Product>> = {
      name: {
        label: profile.item,
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
    if (!menu && profile.lots) {
      columns.lot = {
        label: t.colLot,
        cell: (product) => <bdi dir="ltr" className="text-ink-2">{product.lots.join(", ")}</bdi>,
        text: (product) => product.lots.join(", "),
        sort: (product) => product.lots[0] ?? null,
      };
    }
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
  }, [t, menu, catalog.batches, flags, language, profile]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={catalog.title ?? t.stockTitle}>
        {!menu ? (
          <Button disabled={readOnly} onClick={() => setImporting(true)}>
            {t.importExcel}
          </Button>
        ) : null}
        <Button kind="primary" disabled={readOnly} onClick={() => setCreating(true)}>
          {catalog.newLabel ?? profile.newItem}
        </Button>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <label className="relative block">
          <span className="sr-only">{t.search}</span>
          <icons.search size={22} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={profile.search}
            spellCheck={false}
            className="min-h-[52px] w-full rounded-xl border-2 border-line-strong bg-surface pe-4 ps-12 text-lg outline-none focus:border-ink"
          />
        </label>

        {/*
          * What needs looking at, as small chips under the search rather than
          * a row of big boxes: only the ones with something in them, so a
          * shop that never counts its stock sees none at all.
          */}
        {filters.length > 1 ? (
          <div className="mt-3 flex flex-wrap gap-2 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none] max-md:[&>button]:shrink-0">
            {filters.map((one) => (
              <button
                key={one.value}
                type="button"
                onClick={() => (one.value === "all" ? setFilter("all") : pick(one.value))}
                className={`flex min-h-[44px] items-center gap-2 rounded-full px-4 text-base font-semibold ${
                  activeFilter === one.value ? "bg-accent font-semibold text-accent-foreground shadow-main" : "border-2 border-line-strong bg-surface text-ink hover:bg-hover"
                }`}
              >
                {one.label}
                <span className={activeFilter === one.value ? "opacity-80" : one.warn ? "text-danger" : "text-ink-3"}>{one.count}</span>
              </button>
            ))}
          </div>
        ) : null}
        {/* What the shelf is worth at cost: not a question a bakery asks of this morning's bread. */}
        {overview && !menu && profile.lowStock && overview.value > 0 ? (
          <p className="mt-3 text-base text-ink-3">
            {t.stockValue} : <bdi className="font-semibold text-ink">{money(overview.value, language)}</bdi>
            {overview.withoutCost > 0 ? ` · ${fill(t.withoutCost, { count: overview.withoutCost })}` : ""}
          </p>
        ) : null}

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
        <SmartImport
          t={t}
          configuration={configuration}
          allowProducts
          prefer="products"
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
