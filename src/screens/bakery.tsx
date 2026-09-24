import { useCallback, useEffect, useMemo, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type DayLine, type Preorder, type Product } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Choices, Confirm, Empty, Field, Notice, Panel, ScreenHeader, day, localDay, money, parseMoney, parseQuantity } from "../ui";
import { PaymentBox, paymentProblem } from "./payment";

/*
 * A bakery's day, on one screen: what came out of the oven, what sold, what
 * was left. The baker types two columns, production in the morning and
 * leftovers at night; the rest is read from the sales.
 */
export function BakeryDay({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const unsoldMode = configuration.features.bakery?.unsold ?? "loss";
  const [lines, setLines] = useState<DayLine[]>([]);
  const [made, setMade] = useState<Record<string, string>>({});
  const [left, setLeft] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);

  const reload = useCallback(() => {
    void machine.bakeryDay().then((answer) => answer.ok && setLines(answer.value));
  }, []);
  useEffect(reload, [reload]);

  const collect = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([productId, text]) => ({ productId, quantity: parseQuantity(text) ?? 0 }))
      .filter((item) => item.quantity > 0);

  async function save(kind: "production" | "unsold") {
    const items = collect(kind === "production" ? made : left);
    if (items.length === 0) return;
    const answer = kind === "production" ? await machine.recordProduction(items) : await machine.recordUnsold(items);
    if (!answer.ok) {
      setNote({ text: answer.reason === "read_only" ? t.readOnly : t.notSaved, kind: "problem" });
      return;
    }
    setNote({ text: kind === "production" ? tt.productionSaved : tt.unsoldSaved, kind: "done" });
    if (kind === "production") setMade({});
    else setLeft({});
    reload();
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={`${tt.productionTitle} · ${day(localDay(), configuration.language.app)}`}>
        <Button kind="primary" disabled={readOnly || collect(made).length === 0} onClick={() => void save("production")}>
          {tt.saveProduction}
        </Button>
        {unsoldMode === "loss" ? (
          <Button disabled={readOnly || collect(left).length === 0} onClick={() => void save("unsold")}>
            {tt.saveUnsold}
          </Button>
        ) : null}
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {note ? <div className="mb-4"><Notice kind={note.kind} text={note.text} /></div> : null}
        {unsoldMode === "loss" ? <p className="mb-4 text-base text-black/60">{tt.unsoldHint}</p> : null}
        {lines.length === 0 ? (
          <Empty title={t.noProducts} body={t.noProductsBody} />
        ) : (
          <table className="w-full text-base">
            <thead>
              <tr className="border-b-2 border-black/10 text-black/60">
                <th className="py-2 text-start font-normal">{t.colName}</th>
                <th className="py-2 text-end font-normal">{tt.produced}</th>
                <th className="py-2 text-end font-normal">{tt.sold}</th>
                <th className="py-2 text-end font-normal">{tt.lost}</th>
                <th className="py-2 text-end font-normal">{tt.left}</th>
                <th className="w-[140px] py-2 text-end font-normal">{tt.produceNow}</th>
                {unsoldMode === "loss" ? <th className="w-[140px] py-2 text-end font-normal">{tt.unsoldNow}</th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.productId} className="border-b border-black/10">
                  <td className="py-2 font-semibold">{configuration.language.app === "ar" && line.nameArabic ? line.nameArabic : line.name}</td>
                  <td className="py-2 text-end"><bdi>{line.produced}</bdi></td>
                  <td className="py-2 text-end"><bdi>{line.sold}</bdi></td>
                  <td className="py-2 text-end"><bdi>{line.lost}</bdi></td>
                  <td className="py-2 text-end font-semibold"><bdi>{line.onHand}</bdi></td>
                  <td className="py-2 ps-3">
                    <input
                      value={made[line.productId] ?? ""}
                      onChange={(event) => setMade({ ...made, [line.productId]: event.target.value })}
                      inputMode="decimal"
                      dir="ltr"
                      aria-label={`${tt.produceNow} ${line.name}`}
                      className="min-h-[44px] w-full rounded-lg border-2 border-black/15 px-2 text-end text-base outline-none focus:border-black"
                    />
                  </td>
                  {unsoldMode === "loss" ? (
                    <td className="py-2 ps-3">
                      <input
                        value={left[line.productId] ?? ""}
                        onChange={(event) => setLeft({ ...left, [line.productId]: event.target.value })}
                        inputMode="decimal"
                        dir="ltr"
                        aria-label={`${tt.unsoldNow} ${line.name}`}
                        className="min-h-[44px] w-full rounded-lg border-2 border-black/15 px-2 text-end text-base outline-none focus:border-black"
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/*
 * Orders taken ahead: a cake for Friday, forty baguettes for a wedding. The
 * list is by the day they are due, so the morning's work reads top down.
 */
export function Preorders({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const language = configuration.language.app;
  const deposits = configuration.features.bakery?.deposit ?? true;
  const [orders, setOrders] = useState<Preorder[]>([]);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Preorder | null>(null);

  const reload = useCallback(() => {
    void machine.preorders("open").then((answer) => answer.ok && setOrders(answer.value));
  }, []);
  useEffect(reload, [reload]);

  const todayIso = localDay();
  const tomorrowIso = localDay(1);
  const dueLabel = (date: string) => (date === todayIso ? tt.today : date === tomorrowIso ? tt.tomorrow : day(date, language));

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.preordersTitle}>
        <Button kind="primary" disabled={readOnly} onClick={() => setCreating(true)}>
          {tt.newPreorder}
        </Button>
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {orders.length === 0 ? (
          <Empty title={tt.noPreorders} />
        ) : (
          <ul className="space-y-3">
            {orders.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => setOpen(order)}
                  className={`flex w-full items-start justify-between gap-4 rounded-xl border-2 p-4 text-start ${order.dueOn <= todayIso ? "border-black" : "border-black/15"}`}
                >
                  <span>
                    <span className="block text-lg font-semibold">
                      {dueLabel(order.dueOn)} · {order.customer}
                    </span>
                    <span className="block text-base text-black/70">
                      {order.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ")}
                    </span>
                    {order.phone ? <bdi dir="ltr" className="block text-base text-black/60">{order.phone}</bdi> : null}
                  </span>
                  <span className="shrink-0 text-end">
                    <bdi className="block text-lg font-semibold">{money(order.total, language)}</bdi>
                    {order.received > 0 ? <span className="block text-base">{fill(tt.depositPaid, { amount: money(order.received, language) })}</span> : null}
                    <span className="block text-base font-semibold">{order.status === "ready" ? tt.ready : tt.pending}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating ? (
        <NewPreorder
          configuration={configuration}
          t={t}
          tt={tt}
          deposits={deposits}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      ) : null}
      {open ? (
        <PreorderPanel
          order={open}
          configuration={configuration}
          t={t}
          tt={tt}
          readOnly={readOnly}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function NewPreorder({
  configuration,
  t,
  tt,
  deposits,
  onClose,
  onSaved,
}: {
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  deposits: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const language = configuration.language.app;
  const [products, setProducts] = useState<Product[]>([]);
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [dueOn, setDueOn] = useState(localDay(1));
  const [lines, setLines] = useState<{ product: Product; quantity: number }[]>([]);
  const [pick, setPick] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [deposit, setDeposit] = useState("");
  const [how, setHow] = useState<"cash" | "mobile">("cash");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void machine.products().then(setProducts);
  }, []);

  const total = useMemo(() => lines.reduce((sum, line) => sum + Math.round(line.quantity * line.product.salePrice), 0), [lines]);
  const depositMinor = deposit.trim() ? parseMoney(deposit) : 0;

  async function save() {
    if (!customer.trim() || lines.length === 0 || depositMinor === null || depositMinor > total) return;
    const answer = await machine.createPreorder({
      customer,
      phone,
      dueOn,
      lines: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity, unitPrice: line.product.salePrice })),
      deposit: depositMinor,
      depositPayment: how,
    });
    if (!answer.ok) {
      setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    onSaved();
  }

  return (
    <Panel
      title={tt.newPreorder}
      onClose={onClose}
      closeLabel={t.close}
      footer={
        <div className="flex items-center justify-between gap-2">
          <bdi className="text-xl font-bold">{money(total, language)}</bdi>
          <Button kind="primary" disabled={!customer.trim() || lines.length === 0 || depositMinor === null || depositMinor > total} onClick={() => void save()}>
            {t.save}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={tt.customer} value={customer} onChange={setCustomer} autoFocus />
        <Field label={tt.phone} value={phone} onChange={setPhone} ltr />
        <Field label={tt.dueOn} value={dueOn} onChange={setDueOn} kind="date" />
        <div className="rounded-lg border-2 border-black/10 p-3">
          <div className="mb-2 text-base font-semibold">{tt.items}</div>
          <ul>
            {lines.map((line, index) => (
              <li key={`${line.product.id}-${index}`} className="flex items-center justify-between border-b border-black/10 py-2 text-base">
                <span>
                  {line.quantity} × {line.product.name}
                </span>
                <Button kind="quiet" onClick={() => setLines(lines.filter((_, at) => at !== index))}>
                  {t.remove}
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-end gap-2">
            <label className="block flex-1">
              <span className="text-base text-black/70">{tt.product}</span>
              <select value={pick} onChange={(event) => setPick(event.target.value)} className="mt-1 min-h-[48px] w-full rounded-lg border-2 border-black/15 bg-surface px-2 text-base">
                <option value="">{tt.choose}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="w-[90px]">
              <Field label={tt.quantityShort} value={quantity} onChange={setQuantity} kind="number" />
            </div>
            <Button
              onClick={() => {
                const product = products.find((one) => one.id === pick);
                const count = parseQuantity(quantity);
                if (!product || !count) return;
                setLines([...lines, { product, quantity: count }]);
                setPick("");
                setQuantity("1");
              }}
            >
              {tt.addItem}
            </Button>
          </div>
        </div>
        {deposits ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={tt.deposit} value={deposit} onChange={setDeposit} kind="amount" error={depositMinor === null ? t.badAmount : null} />
            <div>
              <div className="mb-1 text-base text-black/70">{t.paymentHow}</div>
              <Choices<"cash" | "mobile"> value={how} onChange={setHow} options={[{ value: "cash", label: t.payCash }, { value: "mobile", label: t.payMobile }]} />
            </div>
          </div>
        ) : null}
        {problem ? <Notice kind="problem" text={problem} /> : null}
      </div>
    </Panel>
  );
}

function PreorderPanel({
  order,
  configuration,
  t,
  tt,
  readOnly,
  onClose,
  onChanged,
}: {
  order: Preorder;
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const language = configuration.language.app;
  const [collecting, setCollecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refund, setRefund] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const due = Math.max(0, order.total - order.received);

  return (
    <Panel title={`${order.customer} · ${day(order.dueOn, language)}`} onClose={onClose} closeLabel={t.close}>
      <ul>
        {order.lines.map((line, index) => (
          <li key={`${line.productId}-${index}`} className="flex justify-between border-b border-black/10 py-2 text-base">
            <span>
              {line.quantity} × {line.name}
            </span>
            <bdi>{money(Math.round(line.quantity * line.unitPrice), language)}</bdi>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-between text-xl font-bold">
        <span>{t.total}</span>
        <bdi>{money(order.total, language)}</bdi>
      </div>
      {order.received > 0 ? <p className="mt-1 text-base">{fill(tt.depositPaid, { amount: money(order.received, language) })}</p> : null}
      <p className="mt-1 text-lg font-semibold">{fill(tt.toCollect, { amount: money(due, language) })}</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {order.status === "pending" ? (
          <Button disabled={readOnly} onClick={() => void machine.preorderReady(order.id).then(onChanged)}>
            {tt.markReady}
          </Button>
        ) : null}
        <Button onClick={() => void machine.printPreorder(order.id)}>{tt.printIt}</Button>
        <Button kind="quiet" disabled={readOnly} onClick={() => setCancelling(true)}>
          {t.cancel}
        </Button>
      </div>

      <div className="mt-6">
        {collecting ? (
          <PaymentBox
            total={due}
            t={t}
            language={language}
            creditEnabled={configuration.common.credit.enabled}
            readOnly={readOnly}
            actionLabel={tt.pay}
            problem={problem}
            onPay={async (choice) => {
              const answer = await machine.collectPreorder(order.id, choice);
              if (!answer.ok) setProblem(paymentProblem(answer.reason, t));
              else onChanged();
            }}
          />
        ) : (
          <Button kind="primary" big wide disabled={readOnly} onClick={() => setCollecting(true)}>
            {tt.collect}
          </Button>
        )}
      </div>

      {cancelling ? (
        <Confirm
          title={t.cancel}
          body={order.received > 0 ? tt.cancelPreorderBody : undefined}
          yes={t.cancel}
          no={tt.back}
          onNo={() => setCancelling(false)}
          onYes={() => {
            setCancelling(false);
            void machine.cancelPreorder(order.id, refund).then(onChanged);
          }}
        >
          {order.received > 0 ? (
            <Choices<"refund" | "keep">
              value={refund ? "refund" : "keep"}
              onChange={(value) => setRefund(value === "refund")}
              options={[
                { value: "refund", label: tt.refund },
                { value: "keep", label: tt.keep },
              ]}
            />
          ) : null}
        </Confirm>
      ) : null}
    </Panel>
  );
}
