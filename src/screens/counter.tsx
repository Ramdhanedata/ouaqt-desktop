import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppLanguage, Configuration } from "@app-ui/config";
import { machine, type Customer, type Order, type OrderLine, type PaymentApp, type Product, type Service } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { icons } from "../icons";
import { AppMark, AppPicker, usePaymentApps } from "../payment-apps";
import { Button, Confirm, Notice, ScreenHeader, clock, money, moneyText, parseMoney } from "../ui";
import { EndOfDay, History, ItemEditor } from "./counter-dialogs";
import { ReceiptView } from "../receipt";
import { paymentProblem } from "./payment";
import { periodOf } from "./reports";

/*
 * The counter of a restaurant or a café, laid out as the owner's own app had
 * it: the menu as cards on the left, sorted by category, with the orders on
 * hold along the bottom; the order being taken on the right, with who it is
 * for, how it is served, and how it is paid. One tap on a card adds it, one
 * tap on a held order brings it back. Nothing is lost between taps: an order
 * lives in the database from its first item, so a closed window or a power
 * cut leaves it where it was.
 */

type Part = { method: "cash" | "mobile"; amount: number; mobileApp?: string; logo?: string | null };

export function Counter({
  configuration,
  t,
  tt,
  readOnly,
}: {
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
}) {
  const language = configuration.language.app;
  const features = configuration.features.restaurant;
  const services = (features?.service ?? ["dine_in", "takeaway"]) as Service[];
  const tables = services.includes("dine_in") && features?.openOrders !== false ? (features?.tables ?? 0) : 0;
  const credit = configuration.common.credit?.enabled === true;
  const kitchenPrinted = features?.kitchen === "printed";

  const [products, setProducts] = useState<Product[]>([]);
  const [category, setCategory] = useState<string>("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ order: Order; lines: OrderLine[] } | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [day, setDay] = useState<{ total: number; count: number }>({ total: 0, count: 0 });
  const [parts, setParts] = useState<Part[]>([]);
  const [amount, setAmount] = useState("");
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* The employee's name as typed: the payment uses it even if the field never lost focus. */
  const [employee, setEmployee] = useState("");
  const { apps } = usePaymentApps();

  const nameOf = useCallback(
    (item: { name: string; nameArabic: string | null }) => (language === "ar" && item.nameArabic ? item.nameArabic : item.name),
    [language]
  );

  const reloadMenu = useCallback(() => {
    void machine.products().then(setProducts);
  }, []);
  const reloadOrders = useCallback(() => {
    void machine.openOrders().then((answer) => answer.ok && setOrders(answer.value));
  }, []);
  const reloadDay = useCallback(() => {
    void machine.reportSummary(periodOf("today")).then((answer) => answer.ok && setDay({ total: answer.value.net, count: answer.value.count }));
  }, []);
  const reloadCurrent = useCallback((id: string | null) => {
    if (!id) {
      setDetail(null);
      return;
    }
    void machine.getOrder(id).then((answer) => setDetail(answer.ok ? answer.value : null));
  }, []);

  useEffect(() => {
    reloadMenu();
    reloadOrders();
    reloadDay();
    if (credit) void machine.customers("").then((answer) => answer.ok && setCustomers(answer.value));
  }, [reloadMenu, reloadOrders, reloadDay, credit]);
  useEffect(() => reloadCurrent(currentId), [currentId, reloadCurrent]);
  useEffect(() => setEmployee(detail?.order.employee ?? ""), [detail?.order.id, detail?.order.employee]);

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)),
    [products]
  );
  useEffect(() => {
    if (category && !categories.includes(category)) setCategory("");
  }, [categories, category]);
  const shown = category ? products.filter((product) => product.category === category) : products;

  const lines = (detail?.lines ?? []).filter((line) => !line.cancelledAt);
  const total = lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice), 0);
  const paid = parts.reduce((sum, part) => sum + part.amount, 0);
  const left = Math.max(0, total - paid);
  const account = detail?.order.customerId ?? null;

  /* Items taken off after part of the bill was paid: the parts no longer fit, so they start again. */
  useEffect(() => {
    if (parts.length > 0 && paid > total) setParts([]);
  }, [parts.length, paid, total]);
  const held = orders.filter((order) => order.id !== currentId);
  const takenTables = new Set(orders.filter((order) => order.id !== currentId && order.tableNo).map((order) => order.tableNo as number));

  const said = (answer: { ok: boolean; reason?: string }) => {
    if (answer.ok) {
      setProblem(null);
      return true;
    }
    setProblem(answer.reason === "read_only" ? t.readOnly : answer.reason === "table taken" ? tt.tableTaken : t.notSaved);
    return false;
  };

  const refreshOrder = () => {
    reloadCurrent(currentId);
    reloadOrders();
  };

  async function add(product: Product) {
    if (readOnly || busy) return;
    setBusy(true);
    let id = currentId;
    if (!id) {
      const started = await machine.startOrder({ service: services[0] });
      if (!said(started) || !started.ok) {
        setBusy(false);
        return;
      }
      id = started.value;
      setCurrentId(id);
      setParts([]);
    }
    const added = await machine.addToOrder({ orderId: id, productId: product.id });
    said(added);
    setBusy(false);
    reloadCurrent(id);
    reloadOrders();
  }

  async function change(line: OrderLine, by: number) {
    said(await machine.changeOrderLine(line.id, line.quantity + by));
    refreshOrder();
  }

  async function update(input: Parameters<typeof machine.updateOrder>[1]) {
    if (!currentId) return;
    said(await machine.updateOrder(currentId, input));
    refreshOrder();
  }

  function hold() {
    setCurrentId(null);
    setParts([]);
    setAmount("");
    reloadOrders();
  }

  function resume(order: Order) {
    setCurrentId(order.id);
    setParts([]);
    setAmount("");
  }

  function addPart(part: Part) {
    if (part.amount <= 0) return;
    setParts((current) => [...current, { ...part, amount: Math.min(part.amount, left) }]);
    setAmount("");
  }

  async function pay() {
    if (!currentId || lines.length === 0 || busy) return;
    setBusy(true);
    const payment = account
      ? { payment: "credit" as const, customerId: account, employee: employee.trim() || null }
      : parts.length === 0
        ? { payment: "cash" as const }
        : {
            payment: "cash" as const,
            parts: parts.map((part) => ({ method: part.method, amount: part.amount, mobileApp: part.mobileApp ?? null })),
          };
    const answer = await machine.payOrder(currentId, payment);
    setBusy(false);
    /* A refused payment says why: an account past its limit, a bill whose parts do not add up. */
    if (!answer.ok) {
      setProblem(answer.reason === "bad_parts" ? t.notSaved : paymentProblem(answer.reason, t));
      return;
    }
    setProblem(null);
    setReceipt(answer.value.id);
    setCurrentId(null);
    setParts([]);
    setAmount("");
    reloadOrders();
    reloadDay();
    const settings = await machine.printSettings();
    if (settings.auto) void machine.printReceipt(answer.value.id);
  }

  const canPay = lines.length > 0 && !readOnly && (account !== null || parts.length === 0 || left === 0);
  const serviceLabel = (service: Service) => (service === "dine_in" ? tt.dineIn : service === "takeaway" ? tt.takeawayShort : tt.deliveryShort);
  const typed = amount.trim() ? parseMoney(amount) : left;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.navCounter}>
        <div className="flex divide-x divide-line rounded-lg border-2 border-line bg-surface rtl:divide-x-reverse">
          <div className="px-4 py-1 text-end">
            <div className="text-base text-ink-3">{tt.dayTotal}</div>
            <div className="text-lg font-bold">
              <bdi>{money(day.total, language)}</bdi>
            </div>
          </div>
          <div className="px-4 py-1 text-end">
            <div className="text-base text-ink-3">{tt.navCounter}</div>
            <div className="text-lg font-bold">
              <bdi>{day.count}</bdi>
            </div>
          </div>
        </div>
        <Button onClick={() => setShowHistory(true)}>
          <span className="flex items-center gap-2">
            <icons.reports size={20} />
            {tt.history}
          </span>
        </Button>
        <Button onClick={() => setShowEnd(true)}>
          <span className="flex items-center gap-2">
            <icons.cash size={20} />
            {tt.endOfDay}
          </span>
        </Button>
      </ScreenHeader>

      <div className="flex min-h-0 flex-1">
        {/* The menu, and the orders on hold under it. */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap gap-2 px-6 pt-4">
            {["", ...categories].map((value) => (
              <button
                key={value || "__all"}
                type="button"
                onClick={() => setCategory(value)}
                className={`min-h-[48px] rounded-full px-5 text-base font-semibold ${
                  category === value ? "bg-ink text-on-ink" : "border-2 border-line-strong bg-surface text-ink hover:bg-hover"
                }`}
              >
                {value || tt.allCategories}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {products.length === 0 && readOnly ? (
              <p className="p-4 text-lg text-ink-3">{tt.menuEmpty}</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
                {shown.map((product) => (
                  <div key={product.id} className="group relative">
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => void add(product)}
                      className="flex min-h-[104px] w-full flex-col justify-between rounded-xl border-2 border-line bg-surface p-4 text-start hover:border-ink disabled:opacity-60"
                    >
                      <span className="pe-10 text-lg font-semibold leading-snug">{nameOf(product)}</span>
                      <bdi className="text-lg font-bold text-accent-strong">{money(product.salePrice, language)}</bdi>
                    </button>
                    {!readOnly ? (
                      <button
                        type="button"
                        aria-label={tt.editItem}
                        title={tt.editItem}
                        onClick={() => setEditing(product)}
                        className="absolute end-1 top-1 flex h-11 w-11 items-center justify-center rounded-lg text-ink-3 opacity-0 hover:bg-hover hover:text-ink focus:opacity-100 group-hover:opacity-100"
                      >
                        <icons.pencil size={18} />
                      </button>
                    ) : null}
                  </div>
                ))}
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() => setEditing("new")}
                    className="flex min-h-[104px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line-strong text-base font-semibold text-ink-2 hover:bg-hover"
                  >
                    <icons.plus size={22} />
                    {tt.newItem}
                  </button>
                ) : null}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t-2 border-line bg-surface px-6 py-3">
            <div className="flex items-center gap-2 text-base font-semibold text-ink-2">
              <span className="h-2.5 w-2.5 rounded-full bg-warning" aria-hidden />
              {tt.held}
            </div>
            {held.length === 0 ? (
              <p className="mt-2 text-base text-ink-3">{tt.noHeld}</p>
            ) : (
              <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
                {held.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => resume(order)}
                    className="min-h-[72px] min-w-[180px] shrink-0 rounded-xl border-2 border-warning bg-warning-soft px-4 py-2 text-start hover:border-ink"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-base font-semibold">
                        {order.tableNo ? fill(tt.table, { n: order.tableNo }) : fill(tt.orderNo, { n: order.number })}
                      </span>
                      <span className="text-base text-ink-3">{clock(order.openedAt)}</span>
                    </span>
                    <bdi className="mt-1 block text-lg font-bold">{money(order.total, language)}</bdi>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* The order being taken. */}
        <aside className="flex w-[440px] shrink-0 flex-col border-s-2 border-line bg-surface">
          <div className="border-b border-line px-5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold">{detail ? fill(tt.orderNo, { n: detail.order.number }) : tt.emptyOrder}</h2>
              {detail ? <span className="text-base text-ink-3">{clock(detail.order.openedAt)}</span> : null}
            </div>
            {detail ? (
              <div className="mt-2 flex gap-2">
                {credit ? (
                  <Select
                    wide
                    label={tt.accountLabel}
                    value={account ?? ""}
                    onChange={(value) => void update({ customerId: value || null })}
                    options={[{ value: "", label: tt.walkIn }, ...customers.map((customer) => ({ value: customer.id, label: customer.name }))]}
                  />
                ) : null}
                {services.length > 1 ? (
                  <Select
                    label={tt.serviceLabel}
                    value={detail.order.service}
                    onChange={(value) => void update({ service: value as Service })}
                    options={services.map((service) => ({ value: service, label: serviceLabel(service) }))}
                  />
                ) : null}
                {tables > 0 && detail.order.service === "dine_in" ? (
                  <Select
                    label={tt.tableLabel}
                    value={detail.order.tableNo ? String(detail.order.tableNo) : ""}
                    onChange={(value) => void update({ tableNo: value ? Number(value) : null })}
                    options={[
                      { value: "", label: tt.noTable },
                      ...Array.from({ length: tables }, (_, index) => index + 1)
                        .filter((number) => !takenTables.has(number))
                        .map((number) => ({ value: String(number), label: fill(tt.table, { n: number }) })),
                    ]}
                  />
                ) : null}
              </div>
            ) : null}
            {detail && account ? (
              <div className="mt-2">
                {account ? (
                  <label className="block">
                    <span className="sr-only">{tt.employee}</span>
                    <input
                      value={employee}
                      onChange={(event) => setEmployee(event.target.value)}
                      placeholder={tt.employee}
                      dir="auto"
                      onBlur={() => {
                        if (employee.trim() !== (detail.order.employee ?? "")) void update({ employee });
                      }}
                      className="min-h-[48px] w-full rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {lines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <icons.inbox size={40} className="text-ink-3" />
                <div className="mt-3 text-lg font-semibold">{tt.emptyOrder}</div>
                <div className="mt-1 text-base text-ink-3">{tt.emptyOrderHint}</div>
              </div>
            ) : (
              <ul>
                {lines.map((line) => (
                  <li key={line.id} className="border-b border-line px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-lg font-semibold leading-snug">{nameOf(line)}</div>
                        <bdi className="text-base text-ink-3">{money(line.unitPrice, language)}</bdi>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label="-1"
                          disabled={readOnly}
                          onClick={() => void change(line, -1)}
                          className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-line-strong text-xl font-bold hover:bg-hover"
                        >
                          −
                        </button>
                        <bdi className="w-8 text-center text-lg font-bold">{line.quantity}</bdi>
                        <button
                          type="button"
                          aria-label="+1"
                          disabled={readOnly}
                          onClick={() => void change(line, 1)}
                          className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-line-strong text-xl font-bold hover:bg-hover"
                        >
                          +
                        </button>
                      </div>
                      <bdi className="w-28 shrink-0 text-end text-lg font-bold">{money(Math.round(line.quantity * line.unitPrice), language)}</bdi>
                    </div>
                    {noteFor === line.id ? (
                      <input
                        autoFocus
                        defaultValue={line.note ?? ""}
                        placeholder={tt.notePlaceholder}
                        dir="auto"
                        onBlur={(event) => {
                          setNoteFor(null);
                          if (event.target.value.trim() !== (line.note ?? "")) {
                            void machine.setLineNote(line.id, event.target.value).then((answer) => {
                              said(answer);
                              refreshOrder();
                            });
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                        }}
                        className="mt-2 min-h-[44px] w-full rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink"
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => setNoteFor(line.id)}
                        className="mt-1 flex min-h-[44px] items-center gap-2 text-base text-ink-3 hover:text-ink"
                      >
                        <icons.pencil size={16} />
                        {line.note ? <span className="text-ink-2">{line.note}</span> : tt.addNote}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Paying. */}
          <div className="shrink-0 border-t-2 border-dashed border-line-strong px-5 py-4">
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-semibold">{t.total}</span>
              <bdi className="text-3xl font-bold">{money(total, language)}</bdi>
            </div>

            {detail && lines.length > 0 && !account ? (
              <div className="mt-3 space-y-2 rounded-xl border-2 border-line p-3">
                {parts.map((part, index) => (
                  <div key={index} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-base font-semibold">
                      {part.method === "mobile" ? <AppMark app={{ name: part.mobileApp ?? "", logo: part.logo ?? null }} size={24} /> : <icons.banknote size={20} />}
                      {part.method === "mobile" ? part.mobileApp : tt.addCash}
                    </span>
                    <span className="flex items-center gap-1">
                      <bdi className="text-base font-bold">{money(part.amount, language)}</bdi>
                      <button
                        type="button"
                        aria-label={tt.removePart}
                        onClick={() => setParts((current) => current.filter((_, at) => at !== index))}
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink"
                      >
                        <icons.close size={18} />
                      </button>
                    </span>
                  </div>
                ))}
                {left > 0 ? (
                  <>
                    {parts.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => addPart({ method: "cash", amount: left })}
                        className="min-h-[44px] w-full rounded-lg border-2 border-success bg-success-soft px-3 text-base font-semibold text-success"
                      >
                        {fill(tt.restInCash, { amount: money(left, language) })}
                      </button>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <input
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder={moneyText(left)}
                        inputMode="decimal"
                        dir="ltr"
                        aria-label={tt.amountLabel}
                        className="min-h-[48px] w-32 rounded-lg border-2 border-line-strong px-3 text-end text-lg outline-none focus:border-ink"
                      />
                      <button
                        type="button"
                        disabled={typed === null || (typed ?? 0) <= 0}
                        onClick={() => addPart({ method: "cash", amount: typed ?? 0 })}
                        className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg border-2 border-line-strong bg-surface text-base font-semibold hover:bg-hover disabled:opacity-40"
                      >
                        <icons.banknote size={20} />
                        {tt.addCash}
                      </button>
                      <button
                        type="button"
                        disabled={typed === null || (typed ?? 0) <= 0}
                        onClick={() => setPicking(true)}
                        className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg border-2 border-line-strong bg-surface text-base font-semibold hover:bg-hover disabled:opacity-40"
                      >
                        <icons.phone size={20} />
                        {tt.addApp}
                      </button>
                    </div>
                    {parts.length > 0 ? <p className="text-base font-semibold text-danger">{fill(tt.remaining, { amount: money(left, language) })}</p> : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {problem ? (
              <div className="mt-3">
                <Notice kind="problem" text={problem} />
              </div>
            ) : null}

            {kitchenPrinted && detail && detail.order.unsent > 0 ? (
              <div className="mt-3">
                <Button
                  wide
                  onClick={() =>
                    void machine.sendToKitchen(detail.order.id, true).then((answer) => {
                      /* Marked sent either way; when the printer did not answer, the dishes are to be called out. */
                      if (said(answer) && answer.ok && answer.value.printed && !answer.value.printed.ok) setProblem(tt.kitchenNotPrinted);
                      refreshOrder();
                    })
                  }
                >
                  {`${tt.sendKitchen} (${detail.order.unsent})`}
                </Button>
              </div>
            ) : null}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                aria-label={tt.cancelOrder}
                title={tt.cancelOrder}
                disabled={!detail || readOnly}
                onClick={() => setCancelling(true)}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-danger bg-danger-soft text-danger disabled:opacity-40"
              >
                <icons.close />
              </button>
              <button
                type="button"
                aria-label={tt.hold}
                title={tt.hold}
                disabled={!detail || lines.length === 0}
                onClick={hold}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-warning bg-warning-soft text-warning disabled:opacity-40"
              >
                <icons.pause />
              </button>
              <button
                type="button"
                disabled={!canPay || busy}
                onClick={() => void pay()}
                className="flex min-h-[56px] min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-ink px-3 text-lg font-bold text-on-ink disabled:opacity-30"
              >
                <icons.check size={22} />
                <span className="truncate">
                  {account ? tt.putOnAccount : parts.length === 0 ? `${tt.addCash} ${money(total, language)}` : fill(tt.pay, { amount: money(total, language) })}
                </span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      {picking ? (
        <AppPicker
          t={t}
          apps={apps}
          chosen={null}
          onPick={(app: PaymentApp) => {
            addPart({ method: "mobile", amount: typed ?? left, mobileApp: app.name, logo: app.logo });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
      {cancelling && detail ? (
        <Confirm
          title={tt.cancelOrderTitle}
          body={tt.cancelOrderBody}
          yes={tt.cancelOrder}
          no={t.cancel}
          onNo={() => setCancelling(false)}
          onYes={() => {
            setCancelling(false);
            void machine.cancelOrder(detail.order.id, tt.cancelReason).then((answer) => {
              if (!said(answer)) return;
              setCurrentId(null);
              setParts([]);
              reloadOrders();
            });
          }}
        />
      ) : null}
      {receipt ? <ReceiptView saleId={receipt} t={t} onClose={() => setReceipt(null)} /> : null}
      {showHistory ? (
        <History
          configuration={configuration}
          t={t}
          tt={tt}
          readOnly={readOnly}
          onClose={() => setShowHistory(false)}
          onReceipt={(id) => setReceipt(id)}
          onReopened={(orderId) => {
            setShowHistory(false);
            setCurrentId(orderId);
            setParts([]);
            reloadOrders();
            reloadDay();
          }}
          onChanged={reloadDay}
        />
      ) : null}
      {showEnd ? <EndOfDay configuration={configuration} t={t} tt={tt} onClose={() => setShowEnd(false)} /> : null}
      {editing ? (
        <ItemEditor
          t={t}
          tt={tt}
          item={editing === "new" ? null : editing}
          category={category}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadMenu();
          }}
        />
      ) : null}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  wide,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** The customer's name needs more room than "Sur place". */
  wide?: boolean;
}) {
  return (
    <label className={`block min-w-0 ${wide ? "flex-[1.5]" : "flex-1"}`} title={label}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="block min-h-[48px] w-full rounded-lg border-2 border-line-strong px-2 text-base outline-none focus:border-ink"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function serviceName(service: string, tt: TradesCopy): string {
  return service === "dine_in" ? tt.dineIn : service === "takeaway" ? tt.takeawayShort : tt.deliveryShort;
}

export function paymentName(payment: string, mobileApp: string | null, t: ScreensCopy, language: AppLanguage): string {
  void language;
  if (payment === "mobile") return mobileApp || t.payMobile;
  if (payment === "credit") return t.payCredit;
  return t.payCash;
}
