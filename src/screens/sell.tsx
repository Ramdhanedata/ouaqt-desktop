import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type Customer, type PastExpiry, type Printed, type Product } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import { Button, Choices, Confirm, Field, Flag, Notice, day, money, parseMoney, parseQuantity } from "../ui";
import { CustomerPicker } from "./payment";
import { AppPayment, openSection, type AppChoice } from "../payment-apps";

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
  const creditEnabled = configuration.common.credit.enabled;
  const discountsEnabled = configuration.common.discounts;

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [allCount, setAllCount] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [expired, setExpired] = useState<Set<string>>(new Set());
  const [payment, setPayment] = useState<Payment>("cash");
  const [appChoice, setAppChoice] = useState<AppChoice | null>(null);
  const [percent, setPercent] = useState("");
  const [received, setReceived] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /* Lines that would sell past expiry, waiting for the pharmacist's answer. */
  const [pastExpiry, setPastExpiry] = useState<PastExpiry[] | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [printing, setPrinting] = useState(false);
  /* Bumped after each sale, so the stock beside each result is today's. */
  const [soldCount, setSoldCount] = useState(0);
  const [all, setAll] = useState<Product[]>([]);
  const [category, setCategory] = useState("__all");
  const searchRef = useRef<HTMLInputElement | null>(null);

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
      if (everything.length <= SHOW_ALL_UNDER) setResults(everything);
    });
  }, [refreshFlags, soldCount]);

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
    searchRef.current?.focus();
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

  const receivedMinor = payment === "cash" && received.trim() ? parseMoney(received) : null;
  const receivedBad = payment === "cash" && received.trim() !== "" && receivedMinor === null;
  const short = receivedMinor !== null && receivedMinor < total ? total - receivedMinor : 0;

  const canCharge =
    lines.length > 0 &&
    !busy &&
    !readOnly &&
    !receivedBad &&
    short === 0 &&
    lines.every((line) => parseQuantity(line.text) !== null && line.quantity > 0) &&
    (payment !== "credit" || customer !== null) &&
    (payment !== "mobile" || appChoice !== null);

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
              : t.saleRefused
      );
      return;
    }

    setDone({ number: answer.value.number, change: answer.value.change, id: answer.value.id, printed: answer.value.printed });
    setLines([]);
    setPercent("");
    setReceived("");
    setCustomer(null);
    setPayment("cash");
    setAppChoice(null);
    refreshFlags();
    setSoldCount((count) => count + 1);
    searchRef.current?.focus();
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

  return (
    <div className="flex h-full">
      {/* The search, and what it found. */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-line p-4">
          <input
            ref={searchRef}
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={onSearchKey}
            placeholder={t.sellSearch}
            spellCheck={false}
            autoComplete="off"
            aria-label={t.sellSearch}
            className="min-h-[56px] w-full rounded-lg border-2 border-line-strong px-4 text-xl outline-none focus:border-ink"
          />
        </div>

        {showTiles && categories.length > 0 ? (
          <div className="shrink-0 border-b border-line px-4 py-3">
            <Choices<string>
              value={category}
              onChange={setCategory}
              options={[{ value: "__all", label: t.all }, ...categories.map((one) => ({ value: one, label: one }))]}
            />
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {showTiles ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-4">
              {(category === "__all" ? all : all.filter((product) => product.category === category)).map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => add(product)}
                  className="flex min-h-[96px] flex-col justify-between rounded-xl border-2 border-line-strong bg-surface p-3 text-start active:bg-hover"
                >
                  <span className="text-base font-semibold leading-snug">
                    {language === "ar" && product.nameArabic ? product.nameArabic : product.name}
                  </span>
                  <span className="flex items-end justify-between gap-2">
                    <bdi className="text-base">{money(product.salePrice, language)}</bdi>
                    {product.tracked ? (
                      <span className={`text-base ${product.onHand <= 0 ? "font-semibold" : "text-ink-3"}`}>
                        <bdi>{product.onHand}</bdi>
                      </span>
                    ) : null}
                  </span>
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
            <p className="p-6 text-lg leading-relaxed text-ink-3">
              {term.trim() ? fill(t.sellNothing, { term: term.trim() }) : t.sellHint}
            </p>
          ) : (
            <ul>
              {results.map((product, index) => {
                const isExpired = expired.has(product.id);
                const next = product.nextExpiry;
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => add(product)}
                      onMouseEnter={() => setHighlight(index)}
                      className={`flex min-h-[64px] w-full items-center justify-between gap-4 border-b border-line px-5 py-3 text-start ${
                        index === highlight && term.trim() ? "bg-hover" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-lg font-semibold">
                          {language === "ar" && product.nameArabic ? product.nameArabic : product.name}
                        </span>
                        <span className="block truncate text-base text-ink-3">
                          {[product.genericName, product.unit].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="block text-lg font-semibold">
                          <bdi>{money(product.salePrice, language)}</bdi>
                        </span>
                        <span className="flex flex-wrap items-center justify-end gap-x-2 text-base text-ink-3">
                          {!product.tracked ? null : product.onHand <= 0 ? (
                            <Flag kind="danger">{t.outOfStock}</Flag>
                          ) : (
                            <span>{fill(t.stockShort, { count: product.onHand })}</span>
                          )}
                          {isExpired ? (
                            <Flag kind="danger">{t.expiredOnShelf}</Flag>
                          ) : next && product.onHand > 0 ? (
                            <span>{fill(t.expiringSoon, { date: day(next, language) })}</span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* The ticket, and how it is paid. */}
      <aside className="flex w-[440px] shrink-0 flex-col border-s-2 border-line bg-surface">
        <div className="flex min-h-[56px] shrink-0 items-center justify-between border-b border-line px-4">
          <h2 className="text-lg font-semibold">{t.ticket}</h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            done ? null : <p className="p-4 text-base text-ink-3">{t.ticketEmpty}</p>
          ) : (
            <ul>
              {lines.map((line) => {
                const lineTotal = Math.round(line.quantity * line.product.salePrice);
                const warn = expired.has(line.product.id)
                  ? { kind: "danger" as const, text: t.expiredWarning }
                  : line.product.tracked && line.product.onHand < line.quantity
                    ? { kind: "warning" as const, text: fill(t.noStockWarning, { count: line.product.onHand }) }
                    : null;
                return (
                  <li key={line.product.id} className="border-b border-line px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-base font-semibold leading-snug">
                        {language === "ar" && line.product.nameArabic ? line.product.nameArabic : line.product.name}
                      </span>
                      <span className="shrink-0 text-base font-semibold">
                        <bdi>{money(lineTotal, language)}</bdi>
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="−"
                        onClick={() => step(line.product.id, -1)}
                        className="h-[48px] w-[48px] rounded-lg border-2 border-line-strong text-xl"
                      >
                        −
                      </button>
                      <input
                        value={line.text}
                        dir="ltr"
                        inputMode="decimal"
                        aria-label={t.quantity}
                        onChange={(event) => setQuantity(line.product.id, event.target.value)}
                        className="h-[48px] w-[72px] rounded-lg border-2 border-line-strong text-center text-lg outline-none focus:border-ink"
                      />
                      <button
                        type="button"
                        aria-label="+"
                        onClick={() => step(line.product.id, 1)}
                        className="h-[48px] w-[48px] rounded-lg border-2 border-line-strong text-xl"
                      >
                        +
                      </button>
                      <span className="flex-1 text-base text-ink-3">
                        × <bdi>{money(line.product.salePrice, language)}</bdi>
                      </span>
                      <Button kind="quiet" onClick={() => setLines((current) => current.filter((one) => one.product.id !== line.product.id))}>
                        {t.remove}
                      </Button>
                    </div>
                    {warn ? (
                      <p className={`mt-2 rounded-md px-3 py-2 text-base leading-snug text-ink ${warn.kind === "danger" ? "bg-danger-soft" : "bg-warning-soft"}`}>
                        <Flag kind={warn.kind}>{warn.text}</Flag>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {done ? (
            <div className="space-y-3 p-4">
              <Notice kind="done" text={fill(t.saleDone, { number: done.number })} />
              {done.change !== null && done.change > 0 ? (
                <p className="text-2xl font-bold">{fill(t.giveBack, { amount: money(done.change, language) })}</p>
              ) : null}
              {done.printed ? <p className="text-base">{done.printed.ok ? t.printed : t.notPrinted}</p> : null}
              <div className="flex gap-2">
                <Button onClick={() => void print(done.id)} disabled={printing}>
                  {t.printReceipt}
                </Button>
                <Button kind="primary" onClick={() => { setDone(null); searchRef.current?.focus(); }}>
                  {t.newSale}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {lines.length > 0 ? (
          <div className="shrink-0 space-y-3 border-t-2 border-line p-4">
            {discountsEnabled ? (
              <div className="flex items-end gap-3">
                <div className="w-[140px]">
                  <Field label={t.discountPercent} value={percent} onChange={setPercent} kind="number" />
                </div>
                {discount > 0 ? (
                  <p className="pb-3 text-base text-ink-2">
                    {t.discount} : <bdi>−{money(discount, language)}</bdi>
                  </p>
                ) : null}
              </div>
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
                <Field label={t.received} value={received} onChange={setReceived} kind="amount" error={receivedBad ? t.badAmount : null} />
                {receivedMinor !== null && !receivedBad ? (
                  <p className="mt-2 text-lg font-semibold">
                    {short > 0
                      ? fill(t.notEnough, { amount: money(short, language) })
                      : `${t.change} : ${money(receivedMinor - total, language)}`}
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

            <div className="flex items-center justify-between text-xl font-bold">
              <span>{t.total}</span>
              <bdi>{money(total, language)}</bdi>
            </div>
            <Button kind="primary" big wide disabled={!canCharge} onClick={() => void charge()}>
              {busy ? t.charging : fill(t.charge, { amount: money(total, language) })}
            </Button>
          </div>
        ) : null}
      </aside>

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
    </div>
  );
}
