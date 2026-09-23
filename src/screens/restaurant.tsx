import { useCallback, useEffect, useMemo, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type Order, type OrderLine, type Product } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Choices, Confirm, Field, Notice, ScreenHeader, clock, money } from "../ui";
import { PaymentBox, paymentProblem } from "./payment";

/*
 * The room, and each table's order.
 *
 * Built fresh on the shared core, with the old restaurant till as the guide
 * to how the evening goes: a table opens when it sits down, orders more than
 * once, the kitchen gets each round on its own ticket, and the bill is paid
 * once at the end. A counter that takes the money first (payWhen "before")
 * charges on the same screen and sends the kitchen its ticket straight
 * after.
 */

export function Floor({
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
  const tables = features?.tables ?? 10;
  const services = features?.service ?? ["dine_in", "takeaway"];
  const [orders, setOrders] = useState<Order[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [delivering, setDelivering] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(() => {
    void machine.openOrders().then((answer) => answer.ok && setOrders(answer.value));
  }, []);
  useEffect(reload, [reload]);

  const byTable = useMemo(() => new Map(orders.filter((o) => o.service === "dine_in" && o.tableNo).map((o) => [o.tableNo as number, o])), [orders]);
  const others = orders.filter((o) => o.service !== "dine_in");

  async function start(input: Parameters<typeof machine.startOrder>[0]) {
    setProblem(null);
    const answer = await machine.startOrder(input);
    if (!answer.ok) {
      setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    setOpen(answer.value);
  }

  if (open) {
    return (
      <OrderView
        id={open}
        configuration={configuration}
        t={t}
        tt={tt}
        readOnly={readOnly}
        onClose={() => {
          setOpen(null);
          reload();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.navTables}>
        {services.includes("takeaway") ? (
          <Button kind="primary" disabled={readOnly} onClick={() => void start({ service: "takeaway" })}>
            {tt.newTakeaway}
          </Button>
        ) : null}
        {services.includes("delivery") ? (
          <Button disabled={readOnly} onClick={() => setDelivering(true)}>
            {tt.newDelivery}
          </Button>
        ) : null}
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {problem ? <div className="mb-4"><Notice kind="problem" text={problem} /></div> : null}
        {services.includes("dine_in") ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {Array.from({ length: tables }, (_, index) => index + 1).map((number) => {
              const order = byTable.get(number);
              return (
                <button
                  key={number}
                  type="button"
                  disabled={readOnly && !order}
                  onClick={() => (order ? setOpen(order.id) : void start({ service: "dine_in", tableNo: number }))}
                  className={`flex min-h-[112px] flex-col justify-between rounded-xl border-2 p-4 text-start ${
                    order ? "border-black bg-black text-white" : "border-black/15 bg-white text-black"
                  }`}
                >
                  <span className="text-xl font-semibold">{fill(tt.table, { n: number })}</span>
                  {order ? (
                    <span className="text-base">
                      <bdi className="block text-lg font-semibold">{money(order.total, language)}</bdi>
                      <span className="block opacity-80">{fill(tt.since, { time: clock(order.openedAt) })}</span>
                      {order.unsent > 0 ? <span className="block font-semibold">{fill(tt.notSent, { count: order.unsent })}</span> : null}
                    </span>
                  ) : (
                    <span className="text-base text-black/50">{tt.free}</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : null}

        {others.length > 0 ? (
          <>
            <h2 className="mt-8 text-xl font-semibold">{tt.openOrders}</h2>
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {others.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => setOpen(order.id)}
                  className="min-h-[96px] rounded-xl border-2 border-black p-4 text-start"
                >
                  <span className="block text-lg font-semibold">
                    {fill(order.service === "takeaway" ? tt.takeaway : tt.delivery, { n: order.number })}
                  </span>
                  {order.customer ? <span className="block text-base">{order.customer}</span> : null}
                  <bdi className="block text-base font-semibold">{money(order.total, language)}</bdi>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {delivering ? (
        <DeliveryDialog
          t={t}
          tt={tt}
          onCancel={() => setDelivering(false)}
          onStart={(input) => {
            setDelivering(false);
            void start({ service: "delivery", ...input });
          }}
        />
      ) : null}
    </div>
  );
}

function DeliveryDialog({
  t,
  tt,
  onCancel,
  onStart,
}: {
  t: ScreensCopy;
  tt: TradesCopy;
  onCancel: () => void;
  onStart: (input: { customer: string; phone: string; address: string }) => void;
}) {
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  return (
    <Confirm title={tt.newDelivery} yes={tt.openOrder} no={t.cancel} onNo={onCancel} onYes={() => onStart({ customer, phone, address })}>
      <div className="space-y-3">
        <Field label={tt.customer} value={customer} onChange={setCustomer} autoFocus />
        <Field label={tt.phone} value={phone} onChange={setPhone} ltr />
        <Field label={tt.address} value={address} onChange={setAddress} />
      </div>
    </Confirm>
  );
}

function OrderView({
  id,
  configuration,
  t,
  tt,
  readOnly,
  onClose,
}: {
  id: string;
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
}) {
  const language = configuration.language.app;
  const features = configuration.features.restaurant;
  const printsKitchen = (features?.kitchen ?? "printed") === "printed";
  const paysFirst = (features?.payWhen ?? "after") === "before";
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [menu, setMenu] = useState<Product[]>([]);
  const [category, setCategory] = useState("__all");
  const [paying, setPaying] = useState(false);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" | "info" } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState("");
  const [noteFor, setNoteFor] = useState<Product | null>(null);
  const [dishNote, setDishNote] = useState("");

  const load = useCallback(() => {
    void machine.getOrder(id).then((answer) => {
      if (answer.ok && answer.value) {
        setOrder(answer.value.order);
        setLines(answer.value.lines);
      }
    });
  }, [id]);
  useEffect(() => {
    load();
    void machine.products().then(setMenu);
  }, [load]);

  const categories = useMemo(
    () => [...new Set(menu.map((product) => product.category).filter((value): value is string => Boolean(value)))].sort(),
    [menu]
  );
  const shown = category === "__all" ? menu : menu.filter((product) => product.category === category);
  const active = lines.filter((line) => !line.cancelledAt);
  const unsent = active.filter((line) => !line.sentAt);

  if (!order) return null;
  const title =
    order.service === "dine_in"
      ? fill(tt.table, { n: order.tableNo ?? "" })
      : fill(order.service === "takeaway" ? tt.takeaway : tt.delivery, { n: order.number });

  const add = async (product: Product, withNote?: string) => {
    setNote(null);
    const answer = await machine.addToOrder({ orderId: id, productId: product.id, note: withNote });
    if (!answer.ok) setNote({ text: answer.reason === "read_only" ? t.readOnly : t.notSaved, kind: "problem" });
    load();
  };

  const send = async () => {
    const answer = await machine.sendToKitchen(id, printsKitchen);
    if (!answer.ok) {
      setNote({ text: t.notSaved, kind: "problem" });
      return;
    }
    if (printsKitchen && answer.value.printed) {
      setNote(answer.value.printed.ok ? { text: tt.kitchenPrinted, kind: "done" } : { text: tt.kitchenNotPrinted, kind: "problem" });
    } else {
      setNote({ text: tt.announceKitchen, kind: "done" });
    }
    load();
  };

  const pay = async (choice: Parameters<typeof machine.payOrder>[1]) => {
    setProblem(null);
    /* A counter that takes the money first sends the kitchen its ticket once paid. */
    const answer = await machine.payOrder(id, choice);
    if (!answer.ok) {
      setProblem(paymentProblem(answer.reason, t));
      return;
    }
    if (paysFirst && unsent.length > 0) await machine.sendToKitchen(id, printsKitchen);
    onClose();
  };

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-[72px] shrink-0 items-center gap-3 border-b border-black/10 px-4">
          <Button onClick={onClose}>{tt.backToFloor}</Button>
          <h1 className="text-2xl font-semibold">{title}</h1>
        </div>
        {categories.length > 0 ? (
          <div className="shrink-0 border-b border-black/10 p-3">
            <Choices<string>
              value={category}
              onChange={setCategory}
              options={[{ value: "__all", label: tt.allCategories }, ...categories.map((one) => ({ value: one, label: one }))]}
            />
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {menu.length === 0 ? (
            <p className="p-4 text-lg text-black/60">{tt.menuEmpty}</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {shown.map((product) => (
                <div key={product.id} className="flex flex-col">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => void add(product)}
                    className="flex min-h-[96px] flex-col justify-between rounded-xl border-2 border-black/15 bg-white p-3 text-start active:bg-black/5 disabled:opacity-40"
                  >
                    <span className="text-base font-semibold leading-snug">
                      {language === "ar" && product.nameArabic ? product.nameArabic : product.name}
                    </span>
                    <bdi className="text-base">{money(product.salePrice, language)}</bdi>
                  </button>
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => {
                      setNoteFor(product);
                      setDishNote("");
                    }}
                    className="mt-1 min-h-[36px] text-base text-black/60 underline-offset-4 hover:underline"
                  >
                    + {tt.addNote}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <aside className="flex w-[440px] shrink-0 flex-col border-s-2 border-black/10 bg-white">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {active.length === 0 ? (
            <p className="p-4 text-base text-black/60">{tt.orderEmpty}</p>
          ) : (
            <ul>
              {active.map((line) => (
                <li key={line.id} className="border-b border-black/10 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-base font-semibold leading-snug">
                        {language === "ar" && line.nameArabic ? line.nameArabic : line.name}
                      </span>
                      {line.note ? <span className="block text-base text-black/60">— {line.note}</span> : null}
                      {line.sentAt ? <span className="block text-base text-black/60">{tt.inKitchen}</span> : null}
                    </span>
                    <bdi className="shrink-0 text-base font-semibold">{money(Math.round(line.quantity * line.unitPrice), language)}</bdi>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-label="−"
                      onClick={() => void machine.changeOrderLine(line.id, line.quantity - 1).then(load)}
                      className="h-[48px] w-[48px] rounded-lg border-2 border-black/15 text-xl"
                    >
                      −
                    </button>
                    <bdi className="w-[48px] text-center text-lg font-semibold">{line.quantity}</bdi>
                    <button
                      type="button"
                      disabled={readOnly || Boolean(line.sentAt)}
                      aria-label="+"
                      onClick={() => void machine.changeOrderLine(line.id, line.quantity + 1).then(load)}
                      className="h-[48px] w-[48px] rounded-lg border-2 border-black/15 text-xl disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 space-y-3 border-t-2 border-black/10 p-4">
          {note ? <Notice kind={note.kind === "problem" ? "problem" : "done"} text={note.text} /> : null}
          <div className="flex items-center justify-between text-xl font-bold">
            <span>{t.total}</span>
            <bdi>{money(order.total, language)}</bdi>
          </div>
          {paying ? (
            <>
              <PaymentBox
                total={order.total}
                t={t}
                language={language}
                creditEnabled={configuration.common.credit.enabled}
                readOnly={readOnly}
                actionLabel={tt.pay}
                problem={problem}
                onPay={pay}
              />
              <Button wide onClick={() => setPaying(false)}>
                {t.cancel}
              </Button>
            </>
          ) : (
            <>
              {!paysFirst ? (
                <Button kind="primary" wide big disabled={readOnly || unsent.length === 0} onClick={() => void send()}>
                  {unsent.length > 0 ? `${tt.sendKitchen} (${unsent.length})` : tt.inKitchen}
                </Button>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Button disabled={active.length === 0} onClick={() => void machine.printBill(id)}>
                  {tt.bill}
                </Button>
                <Button kind={paysFirst ? "primary" : "secondary"} disabled={readOnly || active.length === 0} onClick={() => setPaying(true)}>
                  {fill(tt.pay, { amount: "" }).trim()}
                </Button>
                {order.service === "dine_in" ? (
                  <Button disabled={readOnly} onClick={() => setMoving(true)}>
                    {tt.moveTable}
                  </Button>
                ) : null}
                <Button kind="quiet" disabled={readOnly} onClick={() => setCancelling(true)}>
                  {tt.cancelOrder}
                </Button>
              </div>
            </>
          )}
        </div>
      </aside>

      {noteFor ? (
        <Confirm
          title={language === "ar" && noteFor.nameArabic ? noteFor.nameArabic : noteFor.name}
          yes={t.save}
          no={t.cancel}
          onNo={() => setNoteFor(null)}
          onYes={() => {
            const product = noteFor;
            setNoteFor(null);
            void add(product, dishNote);
          }}
        >
          <Field label={tt.addNote} value={dishNote} onChange={setDishNote} placeholder={tt.notePlaceholder} autoFocus />
        </Confirm>
      ) : null}
      {cancelling ? (
        <Confirm
          title={tt.cancelOrder}
          body={tt.cancelOrderBody}
          yes={tt.cancelOrder}
          no={t.cancel}
          onNo={() => setCancelling(false)}
          onYes={() => {
            if (!reason.trim()) return;
            setCancelling(false);
            void machine.cancelOrder(id, reason).then((answer) => (answer.ok ? onClose() : setNote({ text: t.notSaved, kind: "problem" })));
          }}
        >
          <Field label={t.reason} value={reason} onChange={setReason} autoFocus />
        </Confirm>
      ) : null}
      {moving ? (
        <Confirm
          title={tt.moveTable}
          yes={t.save}
          no={t.cancel}
          onNo={() => setMoving(false)}
          onYes={() => {
            const number = Number(target);
            if (!Number.isInteger(number) || number < 1) return;
            setMoving(false);
            void machine.moveOrder(id, number).then((answer) => {
              if (!answer.ok) setNote({ text: answer.reason === "table taken" ? tt.tableTaken : t.notSaved, kind: "problem" });
              load();
            });
          }}
        >
          <Field label={tt.moveTo} value={target} onChange={setTarget} kind="number" autoFocus />
        </Confirm>
      ) : null}
    </div>
  );
}
