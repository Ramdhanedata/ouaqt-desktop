import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { coverPayers, type Configuration } from "@app-ui/config";
import { formatPercent } from "@app-ui/format";
import { coveredPart } from "@app-ui/money";
import { machine, type CoverShares, type Customer, type PastExpiry, type Printed, type Product } from "../bridge";
import { CoverChoice, NO_COVER, draftShare, fundName, type CoverDraft } from "../cover";
import { fill, type ScreensCopy } from "../i18n/screens";
import { Button, Choices, Confirm, Flag, Notice, day, money, moneyText, parseMoney, parseQuantity, useNarrow, useDataTick } from "../ui";
import { TillHeader } from "./till-header";
import { copyFor } from "../i18n";
import { History } from "./counter-dialogs";
import { icons } from "../icons";
import { CustomerPicker } from "./payment";
import { AppPayment, openSection, type AppChoice } from "../payment-apps";
import { ReceiptView } from "../receipt";
import { productProfile } from "../i18n/products";
import { tradesFor } from "../i18n/trades";
import { periodOf } from "./reports";

/*
 * Selling by search, the way the old pharmacy till did it.
 *
 * A pharmacy has thousands of products and no two boxes look alike, so the
 * counter is a search box, not a wall of tiles: type the first letters of the
 * brand or the generic name, or scan the box, pick, and the box clears for
 * the next one. The ticket sits on the other side with the payment under it.
 *
 * What the old till did and this one keeps: both names searched, the stock
 * shown beside each result, cash or a mobile app with its name, a discount
 * where the shop gives them. What it did and this one does not: refuse a sale
 * because the stock figure says zero. Stock counts are wrong in real shops,
 * and a till that will not sell what is in the customer's hand stops the
 * counter; it warns instead, and the Stock screen is where the count is put
 * right.
 */

type Line = { product: Product; quantity: number; text: string };

type Payment = "cash" | "mobile" | "credit";

type Done = { number: number; change: number | null; id: string; printed: Printed | null };


/* Show every product while there are few enough to scan by eye. */
const SHOW_ALL_UNDER = 40; // not-a-rule: a screenful

export function Sell({
  configuration,
  t,
  readOnly,
  tiles = false,
}: {
  configuration: Configuration;
  t: ScreensCopy;
  readOnly: boolean;
  /* Tiles to tap beside the search, for a shop that picks by eye. */
  tiles?: boolean;
}) {
  const language = configuration.language.app;
  /* How this trade looks for what it sells: a DCI and a barcode for a pharmacy, a name for a bakery. */
  const profile = useMemo(() => productProfile(configuration), [configuration]);
  const creditEnabled = configuration.common.credit.enabled;
  const discountsEnabled = configuration.common.discounts;
  /* The funds a conventionnée pharmacy named in the builder; none for everybody else. */
  const payers = useMemo(() => coverPayers(configuration), [configuration]);

  const [term, setTerm] = useState("");
  /*
   * On a phone the products and the ticket do not fit side by side: the
   * products fill the screen, a bar at the bottom carries the ticket's count
   * and total, and pressing it brings the ticket up over them. The search
   * never pulls the keyboard up by itself there: the cashier taps it.
   */
  const narrow = useNarrow();
  const [ticketOpen, setTicketOpen] = useState(false);
  const refocus = () => {
    if (!narrow) searchRef.current?.focus();
  };
  const [results, setResults] = useState<Product[]>([]);
  const [allCount, setAllCount] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [expired, setExpired] = useState<Set<string>>(new Set());
  const [payment, setPayment] = useState<Payment>("cash");
  const [appChoice, setAppChoice] = useState<AppChoice | null>(null);
  const [percent, setPercent] = useState("");
  /* A discount is one tap away and closed until wanted, so a sale without one sees nothing of it. */
  const [discounting, setDiscounting] = useState(false);
  const [received, setReceived] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [cover, setCover] = useState<CoverDraft>(NO_COVER);
  const [usualShares, setUsualShares] = useState<CoverShares>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /* Lines that would sell past expiry, waiting for the pharmacist's answer. */
  const [pastExpiry, setPastExpiry] = useState<PastExpiry[] | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  /* Bumped after each sale, so the stock beside each result is today's. */
  const [soldCount, setSoldCount] = useState(0);
  const [all, setAll] = useState<Product[]>([]);
  const [category, setCategory] = useState("__all");
  /* The day so far, read again after each sale, as on the restaurant's till. */
  const [today, setToday] = useState({ total: 0, count: 0 });
  /* Today's sales, each with its receipt and a delete for one rung up by mistake. */
  const [showHistory, setShowHistory] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  /* Another device's work: the figures and the shelf follow. The ticket on screen is this cashier's, and stays. */
  const dataTick = useDataTick();

  useEffect(() => {
    void machine.reportSummary(periodOf("today")).then((answer) => answer.ok && setToday({ total: answer.value.net, count: answer.value.count }));
  }, [soldCount, dataTick]);

  /* Read again after each sale, so a share the manager just changed is where the next one starts. */
  useEffect(() => {
    if (payers.length > 0) void machine.coverShares().then((answer) => answer.ok && setUsualShares(answer.value));
  }, [payers, soldCount]);

  const refreshFlags = useCallback(() => {
    void machine.stockFlags().then((answer) => {
      if (answer.ok) setExpired(new Set(answer.value.expired));
    });
  }, []);

  useEffect(() => {
    refreshFlags();
    void machine.products().then((everything) => {
      setAllCount(everything.length);
      setAll(everything);
      /* Not over what the cashier is searching for. */
      if (everything.length <= SHOW_ALL_UNDER && !searchRef.current?.value.trim()) setResults(everything);
    });
  }, [refreshFlags, soldCount, dataTick]);

  const categories = useMemo(
    () => [...new Set(all.map((product) => product.category).filter((value): value is string => Boolean(value)))].sort(),
    [all]
  );
  const showTiles = tiles && !term.trim() && all.length > 0;

  /* The search follows the typing, a little behind it so a scanner's burst is one query. */
  useEffect(() => {
    const clean = term.trim();
    const timer = setTimeout(() => {
      if (!clean) {
        if (allCount !== null && allCount <= SHOW_ALL_UNDER) void machine.products().then(setResults);
        else setResults([]);
      } else {
        void machine.products(clean).then(setResults);
      }
      setHighlight(0);
    }, 120); // not-a-rule: long enough for a barcode scanner to finish typing
    return () => clearTimeout(timer);
  }, [term, allCount, soldCount]);

  const add = (product: Product) => {
    setDone(null);
    setProblem(null);
    setLines((current) => {
      const found = current.find((line) => line.product.id === product.id);
      if (found) {
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1, text: String(line.quantity + 1) } : line
        );
      }
      return [...current, { product, quantity: 1, text: "1" }];
    });
    setTerm("");
    refocus();
  };

  const setQuantity = (id: string, text: string) => {
    setLines((current) =>
      current.map((line) => {
        if (line.product.id !== id) return line;
        const parsed = parseQuantity(text);
        return { ...line, text, quantity: parsed !== null && parsed > 0 ? parsed : line.quantity };
      })
    );
  };

  const step = (id: string, by: number) => {
    setLines((current) =>
      current.flatMap((line) => {
        if (line.product.id !== id) return [line];
        const next = Math.round((line.quantity + by) * 1000) / 1000;
        return next <= 0 ? [] : [{ ...line, quantity: next, text: String(next) }];
      })
    );
  };

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + Math.round(line.quantity * line.product.salePrice), 0),
    [lines]
  );
  const pct = discountsEnabled ? Math.min(100, Math.max(0, Number(percent.replace(",", ".")) || 0)) : 0;
  const discount = Math.round((subtotal * pct) / 100);
  const total = subtotal - discount;

  /*
   * The fund's part, worked out the way the database will work it out, so
   * the figure on screen is the one on the receipt. The customer pays the rest.
   */
  const covering = cover.payer !== "none" && payers.includes(cover.payer) ? cover.payer : null;
  const share = covering ? draftShare(cover) : null;
  const covered = covering && share !== null ? coveredPart(total, share) : 0;
  const toPay = total - covered;
  const memberMissing = covering !== null && !cover.member.trim();
  const coverBad = covering !== null && share === null;

  const receivedMinor = payment === "cash" && received.trim() ? parseMoney(received) : null;
  const receivedBad = payment === "cash" && received.trim() !== "" && receivedMinor === null;
  const short = receivedMinor !== null && receivedMinor < toPay ? toPay - receivedMinor : 0;

  const canCharge =
    lines.length > 0 &&
    !busy &&
    !readOnly &&
    !receivedBad &&
    short === 0 &&
    !coverBad &&
    lines.every((line) => parseQuantity(line.text) !== null && line.quantity > 0) &&
    (payment !== "credit" || customer !== null);

  /*
   * A medicine past its date is not refused: the pharmacist is shown which
   * one and since when, and decides. Refusing only teaches him to sell
   * around the software. If he goes ahead, the sale says so.
   */
  async function charge(acceptPastExpiry = false) {
    if (!canCharge) return;
    const saleLines = lines.map((line) => ({ productId: line.product.id, quantity: line.quantity, unitPrice: line.product.salePrice }));
    if (!acceptPastExpiry) {
      const check = await machine.pastExpiry(saleLines);
      if (check.ok && check.value.length > 0) {
        setPastExpiry(check.value);
        return;
      }
    }
    setBusy(true);
    setProblem(null);
    const answer = await machine.recordSale({
      payment,
      lines: saleLines,
      pastExpiry: acceptPastExpiry,
      discount,
      mobileApp: payment === "mobile" ? appChoice?.name ?? null : null,
      paymentReference: payment === "mobile" ? appChoice?.reference.trim() || null : null,
      received: receivedMinor,
      customerId: payment === "credit" ? (customer?.id ?? null) : null,
      cover: covering && share !== null ? { payer: covering, memberNumber: cover.member, share } : null,
    });
    setBusy(false);

    if (!answer.ok) {
      setProblem(
        answer.reason === "credit_limit"
          ? t.creditLimit
          : answer.reason === "no_customer"
            ? t.needCustomer
            : answer.reason === "read_only"
              ? t.readOnly
              : answer.reason === "bad_cover"
                ? t.badCover
                : t.saleRefused
      );
      return;
    }

    setDone({ number: answer.value.number, change: answer.value.change, id: answer.value.id, printed: answer.value.printed });
    setLines([]);
    setPercent("");
    setDiscounting(false);
    setReceived("");
    setCustomer(null);
    setPayment("cash");
    setAppChoice(null);
    /* The next customer is somebody else, with his own card or none. */
    setCover(NO_COVER);
    refreshFlags();
    setSoldCount((count) => count + 1);
    refocus();
  }

  async function print(id: string) {
    setPrinting(true);
    const printed = await machine.printReceipt(id);
    setPrinting(false);
    setDone((current) => (current && current.id === id ? { ...current, printed } : current));
  }

  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const exact = results.find((product) => product.barcode && product.barcode === term.trim());
      const chosen = exact ?? results[highlight];
      if (chosen && term.trim()) add(chosen);
    } else if (event.key === "Escape") {
      setTerm("");
    }
  };

  /* An emptied ticket on a phone goes back to the products by itself. */
  useEffect(() => {
    if (lines.length === 0 && !done) setTicketOpen(false);
  }, [lines.length, done]);

  const tt = tradesFor(language);
  const nameOf = (product: Product) => (language === "ar" && product.nameArabic ? product.nameArabic : product.name);
  const itemCount = lines.reduce((count, line) => count + (Number.isFinite(line.quantity) ? Math.ceil(line.quantity) : 0), 0);
  const clearTicket = () => {
    setLines([]);
    setPercent("");
    setDiscounting(false);
    setReceived("");
    setProblem(null);
    refocus();
  };

  /*
   * Laid out like the restaurant's counter, which owners found the clearest:
   * the screen's name and the day on top, the products under the search on
   * one side, the ticket on the other with its total in large and one big
   * button to take the money. Each product shows its name and its price and
   * nothing else; the stock count lives in Stock.
   */
  return (
    <div className="flex h-full flex-col">
      <TillHeader
        title={copyFor(language).navSale}
        total={today.total}
        count={today.count}
        countLabel={t.salesCount}
        onHistory={() => setShowHistory(true)}
        configuration={configuration}
        t={t}
        tt={tt}
      />

      <div className="flex min-h-0 flex-1">
      {/* The search, and what it found. */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 px-6 pt-4 max-md:px-4 max-md:pt-3">
          <label className="relative block">
            <span className="sr-only">{profile.search}</span>
            <icons.search size={22} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              ref={searchRef}
              autoFocus={!narrow}
              enterKeyHint="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={onSearchKey}
              placeholder={profile.search}
              spellCheck={false}
              autoComplete="off"
              className="min-h-[52px] w-full rounded-xl border-2 border-line-strong bg-surface pe-4 ps-12 text-lg outline-none focus:border-ink"
            />
          </label>
        </div>

        {showTiles && categories.length > 0 ? (
          <div className="flex shrink-0 flex-wrap gap-2 px-6 pt-3 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4 max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&>button]:shrink-0">
            {["__all", ...categories].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setCategory(value)}
                className={`min-h-[48px] rounded-full px-5 text-base font-semibold ${
                  category === value ? "bg-accent font-semibold text-accent-foreground shadow-main" : "border-2 border-line-strong bg-surface text-ink hover:bg-hover"
                }`}
              >
                {value === "__all" ? t.all : value}
              </button>
            ))}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {showTiles ? (
            /* The restaurant's tiles: the name, and the price in the brand's gold. On a phone, one row each. */
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 px-6 py-4 max-md:grid-cols-1 max-md:gap-2 max-md:px-4 max-md:py-3">
              {(category === "__all" ? all : all.filter((product) => product.category === category)).map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => add(product)}
                  className="flex min-h-[104px] flex-col justify-between rounded-xl border-2 border-line bg-surface p-4 text-start hover:border-ink active:bg-hover max-md:min-h-[64px] max-md:flex-row max-md:items-center max-md:gap-3 max-md:py-3"
                >
                  <span className="text-lg font-semibold leading-snug max-md:min-w-0 max-md:flex-1">{nameOf(product)}</span>
                  <bdi className="text-lg font-bold text-accent-strong max-md:shrink-0">{money(product.salePrice, language)}</bdi>
                </button>
              ))}
            </div>
          ) : allCount === 0 && !term.trim() ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="text-xl font-semibold">{t.noProducts}</div>
              <div className="mt-2 max-w-md text-base leading-relaxed text-ink-3">{t.sellNoProducts}</div>
              <div className="mt-5">
                <Button kind="primary" onClick={() => openSection("stock", "menu")}>
                  {t.openStock}
                </Button>
              </div>
            </div>
          ) : results.length === 0 ? (
            <p className="px-6 py-6 text-lg leading-relaxed text-ink-3 max-md:px-4">
              {term.trim() ? fill(t.sellNothing, { term: term.trim() }) : profile.hint}
            </p>
          ) : (
            /* A long shelf, as a pharmacy's: one row per product, its name and price, and a red word only for a lot past its date. */
            <ul className="space-y-2 px-6 py-4 max-md:px-4 max-md:py-3">
              {results.map((product, index) => {
                const detail = [product.genericName, product.unit].filter(Boolean).join(" · ");
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => add(product)}
                      onMouseEnter={() => setHighlight(index)}
                      className={`flex min-h-[64px] w-full items-center justify-between gap-4 rounded-xl border-2 bg-surface px-4 py-3 text-start hover:border-ink ${
                        index === highlight && term.trim() ? "border-ink" : "border-line"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-lg font-semibold leading-snug max-md:line-clamp-2">{nameOf(product)}</span>
                        {detail ? <span className="block truncate text-base text-ink-3">{detail}</span> : null}
                        {expired.has(product.id) ? (
                          <span className="block text-base">
                            <Flag kind="danger">{t.expiredOnShelf}</Flag>
                          </span>
                        ) : null}
                      </span>
                      <bdi className="shrink-0 text-lg font-bold text-accent-strong">{money(product.salePrice, language)}</bdi>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {narrow && (lines.length > 0 || done) ? (
          <div className="shrink-0 border-t-2 border-line bg-surface p-3">
            <button
              type="button"
              onClick={() => setTicketOpen(true)}
              className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl bg-accent px-4 text-accent-foreground active:brightness-95"
            >
              <span className="flex items-center gap-3">
                <icons.ticket className="shrink-0" />
                <span className="text-lg font-semibold">{t.ticketShow}</span>
                {lines.length > 0 ? (
                  <span className="flex h-7 min-w-[28px] items-center justify-center rounded-full bg-surface px-2 text-base font-bold text-accent-strong">
                    {itemCount}
                  </span>
                ) : null}
              </span>
              {lines.length > 0 ? <bdi className="text-lg font-bold">{money(toPay, language)}</bdi> : null}
            </button>
          </div>
        ) : null}
      </section>

      {/* The ticket, and how it is paid. On a phone, over the products, when asked for. */}
      <aside
        className={`flex w-[440px] shrink-0 flex-col border-s-2 border-line bg-surface ${
          narrow ? (ticketOpen ? "fixed inset-0 z-40 w-full border-s-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]" : "hidden") : ""
        }`}
      >
        {narrow ? (
          <button type="button" onClick={() => setTicketOpen(false)} className="flex min-h-[52px] shrink-0 items-center gap-2 border-b border-line px-4 text-base font-medium text-ink-2 active:bg-hover">
            <icons.back className="shrink-0 rtl:-scale-x-100" />
            {t.ticketBack}
          </button>
        ) : null}
        <div className="flex shrink-0 items-baseline justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-xl font-semibold">{t.ticket}</h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            done ? null : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <icons.inbox size={40} className="text-ink-3" />
                <div className="mt-3 text-lg font-semibold">{tt.emptyOrder}</div>
                <div className="mt-1 text-base text-ink-3">{t.ticketEmptyHint}</div>
              </div>
            )
          ) : (
            <ul>
              {lines.map((line) => (
                <li key={line.product.id} className="border-b border-line px-5 py-3">
                  {/* On a phone the name and the line's total share the first row, and the quantity goes under them. */}
                  <div className="flex items-center justify-between gap-3 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-y-2">
                    <div className="min-w-0 flex-1">
                      <span className="block break-words text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{nameOf(line.product)}</span>
                      <bdi className="text-base text-ink-3">{money(line.product.salePrice, language)}</bdi>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 max-md:col-span-2 max-md:row-start-2">
                      <button
                        type="button"
                        aria-label="−"
                        onClick={() => step(line.product.id, -1)}
                        className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-line-strong text-xl font-bold hover:bg-hover"
                      >
                        −
                      </button>
                      {/* Typed when sold by weight or by the dozen; the buttons are enough the rest of the time. */}
                      <input
                        value={line.text}
                        dir="ltr"
                        inputMode="decimal"
                        aria-label={t.quantity}
                        onChange={(event) => setQuantity(line.product.id, event.target.value)}
                        onFocus={(event) => event.target.select()}
                        className="h-11 w-14 rounded-lg border-2 border-transparent bg-transparent text-center text-lg font-bold outline-none hover:border-line focus:border-ink"
                      />
                      <button
                        type="button"
                        aria-label="+"
                        onClick={() => step(line.product.id, 1)}
                        className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-line-strong text-xl font-bold hover:bg-hover"
                      >
                        +
                      </button>
                    </div>
                    <bdi className="w-28 shrink-0 text-end text-lg font-bold max-md:col-start-2 max-md:row-start-1 max-md:w-auto">{money(Math.round(line.quantity * line.product.salePrice), language)}</bdi>
                  </div>
                  {expired.has(line.product.id) ? (
                    <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-base leading-snug text-ink">
                      <Flag kind="danger">{t.expiredWarning}</Flag>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {done ? (
            <div className="space-y-3 p-5">
              <Notice kind="done" text={fill(t.saleDone, { number: done.number })} />
              {done.change !== null && done.change > 0 ? (
                <p className="text-2xl font-bold">{fill(t.giveBack, { amount: money(done.change, language) })}</p>
              ) : null}
              {done.printed ? <p className="text-base">{done.printed.ok ? t.printed : t.notPrinted}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void print(done.id)} disabled={printing}>
                  {t.printReceipt}
                </Button>
                <Button onClick={() => setReceipt(done.id)}>{t.seeReceipt}</Button>
                <Button kind="primary" onClick={() => { setDone(null); setTicketOpen(false); refocus(); }}>
                  {t.newSale}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {lines.length > 0 ? (
          <div className="shrink-0 space-y-3 border-t-2 border-dashed border-line-strong px-5 py-4">
            {covering ? (
              <div className="space-y-1 text-base">
                <div className="flex items-center justify-between">
                  <span>{t.total}</span>
                  <bdi>{money(total, language)}</bdi>
                </div>
                <div className="flex items-center justify-between">
                  <span>{fill(t.coverPart, { fund: fundName(covering, t), share: share === null ? "…" : formatPercent(share, language) })}</span>
                  <bdi>−{money(covered, language)}</bdi>
                </div>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-lg font-semibold">{covering ? t.toPay : t.total}</span>
              <bdi className="text-3xl font-bold">{money(toPay, language)}</bdi>
            </div>

            {discountsEnabled ? (
              discounting || percent !== "" ? (
                <div className="flex items-center gap-3">
                  <label className="flex flex-1 items-center gap-3">
                    <span className="text-base text-ink-2">{t.discountPercent}</span>
                    <input
                      autoFocus
                      value={percent}
                      onChange={(event) => setPercent(event.target.value)}
                      inputMode="decimal"
                      dir="ltr"
                      className="min-h-[48px] w-24 rounded-lg border-2 border-line-strong px-3 text-end text-lg outline-none focus:border-ink"
                    />
                  </label>
                  {discount > 0 ? <bdi className="text-base font-semibold text-ink-2">−{money(discount, language)}</bdi> : null}
                </div>
              ) : (
                <button type="button" onClick={() => setDiscounting(true)} className="min-h-[44px] text-base text-ink-2 underline-offset-4 hover:underline">
                  {t.addDiscount}
                </button>
              )
            ) : null}

            {payers.length > 0 ? (
              <CoverChoice t={t} payers={payers} draft={cover} usual={usualShares} onChange={(next) => { setCover(next); setProblem(null); }} />
            ) : null}

            <Choices<Payment>
              value={payment}
              onChange={(value) => { setPayment(value); setProblem(null); }}
              options={[
                { value: "cash", label: t.payCash },
                { value: "mobile", label: t.payMobile },
                ...(creditEnabled ? [{ value: "credit" as const, label: t.payCredit }] : []),
              ]}
            />

            {payment === "cash" ? (
              <div>
                {/* Optional: typed only when the change has to be worked out. */}
                <label className="flex items-center justify-between gap-3">
                  <span className="text-base text-ink-2">{t.received}</span>
                  <input
                    value={received}
                    onChange={(event) => setReceived(event.target.value)}
                    inputMode="decimal"
                    dir="ltr"
                    placeholder={moneyText(toPay)}
                    className={`min-h-[48px] w-40 rounded-lg border-2 px-3 text-end text-lg outline-none focus:border-ink ${receivedBad ? "border-danger" : "border-line-strong"}`}
                  />
                </label>
                {receivedBad ? <p className="mt-1 text-base font-semibold text-danger">{t.badAmount}</p> : null}
                {receivedMinor !== null && !receivedBad ? (
                  <p className={`mt-2 text-lg font-semibold ${short > 0 ? "text-danger" : ""}`}>
                    {short > 0
                      ? fill(t.notEnough, { amount: money(short, language) })
                      : `${t.change} : ${money(receivedMinor - toPay, language)}`}
                  </p>
                ) : null}
              </div>
            ) : null}

            {payment === "mobile" ? <AppPayment t={t} value={appChoice} onChange={setAppChoice} /> : null}

            {payment === "credit" ? (
              <CustomerPicker t={t} language={language} chosen={customer} onChoose={setCustomer} />
            ) : null}

            {problem ? <Notice kind="problem" text={problem} /> : null}
            {readOnly ? <Notice kind="problem" text={t.readOnly} /> : null}
            {memberMissing ? <Notice kind="info" text={t.memberMissing} /> : null}

            <div className="flex gap-2">
              <button
                type="button"
                aria-label={t.clearTicket}
                title={t.clearTicket}
                disabled={busy}
                onClick={clearTicket}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-danger bg-danger-soft text-danger disabled:opacity-40"
              >
                <icons.close />
              </button>
              <button
                type="button"
                disabled={!canCharge}
                onClick={() => void charge()}
                className="flex min-h-[56px] min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-accent px-3 text-lg font-bold text-accent-foreground shadow-main active:brightness-95 disabled:opacity-30 disabled:shadow-none"
              >
                <icons.check size={22} />
                <span className="truncate">{busy ? t.charging : fill(t.charge, { amount: money(toPay, language) })}</span>
              </button>
            </div>
          </div>
        ) : null}
      </aside>
      </div>

      {pastExpiry ? (
        <Confirm
          title={t.pastExpiryTitle}
          body={t.pastExpiryBody}
          yes={t.pastExpiryGo}
          no={t.pastExpiryBack}
          onNo={() => setPastExpiry(null)}
          onYes={() => {
            setPastExpiry(null);
            void charge(true);
          }}
        >
          <ul className="space-y-2">
            {pastExpiry.map((item, index) => {
              const name = language === "ar" && item.nameArabic ? item.nameArabic : item.name;
              const date = day(item.expiresOn, language);
              return (
                <li key={index} className="text-lg font-semibold leading-snug">
                  {item.lot ? fill(t.pastExpiryLine, { name, lot: item.lot, date }) : fill(t.pastExpiryLineNoLot, { name, date })}
                </li>
              );
            })}
          </ul>
        </Confirm>
      ) : null}
      {receipt ? <ReceiptView saleId={receipt} t={t} onClose={() => setReceipt(null)} /> : null}
      {showHistory ? (
        <History
          configuration={configuration}
          t={t}
          tt={tt}
          readOnly={readOnly}
          asSales
          onClose={() => setShowHistory(false)}
          onReceipt={(id) => setReceipt(id)}
          onChanged={() => setSoldCount((count) => count + 1)}
        />
      ) : null}
    </div>
  );
}
