import { useEffect, useState, type ReactNode } from "react";
import type { Configuration } from "@app-ui/config";
import { formatDateTime, formatMoney, formatQuantity } from "@app-ui/format";
import { machine, type Product, type PrintedTable, type SaleDetail, type SaleSummary, type Summary, type TopProduct } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { icons } from "../icons";
import { openSection } from "../payment-apps";
import { Button, Confirm, Field, Notice, clock, localDay, money, moneyText, parseMoney } from "../ui";
import { periodOf } from "./reports";

/*
 * What opens over the counter: the receipt after a payment, the day's
 * history, the end of the day, and a menu item being added or changed. Each
 * is a dialog, as in the owner's own app, so the order being taken is still
 * there when it closes.
 */

function Dialog({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim p-6" onMouseDown={onClose}>
      <div
        className={`flex max-h-full w-full flex-col rounded-xl bg-surface shadow-2xl ${wide ? "max-w-3xl" : "max-w-md"}`}
        role="dialog"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-[64px] shrink-0 items-center justify-between gap-4 border-b border-line px-6">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button type="button" aria-label="×" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-hover">
            <icons.close />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="shrink-0 border-t border-line px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

/* The receipt, on screen as it prints: the shop, the order, each line, how it was paid. */
export function ReceiptView({
  saleId,
  configuration,
  t,
  tt,
  onClose,
}: {
  saleId: string;
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  onClose: () => void;
}) {
  const language = configuration.language.app;
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  useEffect(() => {
    void machine.saleDetail(saleId).then((answer) => answer.ok && setSale(answer.value));
  }, [saleId]);
  const business = configuration.business;
  const name = language === "ar" && business.nameArabic ? business.nameArabic : business.nameLatin;

  return (
    <Dialog
      title={tt.receiptTitle}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            onClick={() =>
              void machine.receiptPdf(saleId).then((answer) => {
                if (!answer.ok) setNote({ text: t.notSaved, kind: "problem" });
              })
            }
          >
            {tt.savePdf}
          </Button>
          <Button
            onClick={() =>
              void machine.printReceipt(saleId).then((printed) => setNote(printed.ok ? { text: t.printed, kind: "done" } : { text: t.notPrinted, kind: "problem" }))
            }
          >
            {tt.printIt}
          </Button>
          <Button kind="primary" onClick={onClose}>
            {t.close}
          </Button>
        </div>
      }
    >
      {sale ? (
        <div className="text-base">
          <div className="text-center">
            {business.logo ? <img src={business.logo} alt="" className="mx-auto mb-2 max-h-16 max-w-[60%] object-contain" /> : null}
            <div className="text-lg font-bold">{name}</div>
            <div className="mt-2 text-ink-2">
              {tt.receiptOrder} : <bdi>{sale.number}</bdi>
            </div>
            <div className="text-ink-2">
              <bdi dir="ltr">{formatDateTime(new Date(sale.occurredAt), language)}</bdi>
            </div>
          </div>
          <table className="mt-4 w-full border-y-2 border-dashed border-line-strong">
            <thead>
              <tr className="text-ink-3">
                <th className="py-2 text-start font-normal">{tt.colItem}</th>
                <th className="py-2 text-end font-normal">{tt.colQty}</th>
                <th className="py-2 text-end font-normal">{tt.colUnit}</th>
                <th className="py-2 text-end font-normal">{tt.colAmount}</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((item, index) => (
                <tr key={index}>
                  <td className="py-1.5">{language === "ar" && item.nameArabic ? item.nameArabic : item.name}</td>
                  <td className="py-1.5 text-end">
                    <bdi>{formatQuantity(item.quantity, language)}</bdi>
                  </td>
                  <td className="py-1.5 text-end">
                    <bdi>{moneyText(item.unitPrice)}</bdi>
                  </td>
                  <td className="py-1.5 text-end">
                    <bdi>{moneyText(item.lineTotal)}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 text-ink-3">{tt.paymentsLabel}</div>
          {sale.parts.length > 1 ? (
            sale.parts.map((part, index) => (
              <div key={index} className="flex justify-between">
                <span>{part.method === "mobile" ? part.mobileApp : t.payCash}</span>
                <bdi>{money(part.amount, language)}</bdi>
              </div>
            ))
          ) : (
            <div className="flex justify-between">
              <span>
                {sale.payment === "mobile" ? sale.mobileApp || t.payMobile : sale.payment === "credit" ? `${t.payCredit} : ${sale.customerName ?? ""}` : t.payCash}
              </span>
              <bdi>{money(sale.total, language)}</bdi>
            </div>
          )}
          {sale.employee ? <div className="text-ink-2">{sale.employee}</div> : null}
          <div className="mt-3 flex items-baseline justify-between border-t-2 border-dashed border-line-strong pt-3">
            <span className="font-bold">{tt.totalPaid}</span>
            <bdi className="text-2xl font-bold">{money(sale.total, language)}</bdi>
          </div>
          <p className="mt-4 text-center text-ink-2">{configuration.receipt.footer || tt.thanks}</p>
          {note ? (
            <div className="mt-3">
              <Notice kind={note.kind} text={note.text} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

/* Today's orders, newest first: the receipt again, back to the counter to change, or deleted. */
export function History({
  configuration,
  t,
  tt,
  readOnly,
  onClose,
  onReceipt,
  onReopened,
  onChanged,
}: {
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
  onReceipt: (saleId: string) => void;
  onReopened: (orderId: string) => void;
  onChanged: () => void;
}) {
  const language = configuration.language.app;
  const [sales, setSales] = useState<SaleSummary[] | null>(null);
  const [deleting, setDeleting] = useState<SaleSummary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const reload = () => {
    const today = periodOf("today");
    void machine.salesBetween(today.from, today.to).then((answer) => answer.ok && setSales(answer.value.filter((sale) => sale.reversesNumber === null)));
  };
  useEffect(reload, []);
  const said = (answer: { ok: boolean; reason?: string }) => {
    setProblem(answer.ok ? null : answer.reason === "read_only" ? t.readOnly : t.notSaved);
    return answer.ok;
  };

  return (
    <Dialog title={tt.historyTitle} onClose={onClose} wide>
      {problem ? (
        <div className="mb-3">
          <Notice kind="problem" text={problem} />
        </div>
      ) : null}
      {sales === null ? null : sales.length === 0 ? (
        <p className="py-8 text-center text-lg text-ink-3">{tt.noOrdersToday}</p>
      ) : (
        <ul className="divide-y divide-line">
          {sales.map((sale) => {
            const voided = sale.status === "voided";
            return (
              <li key={sale.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold">
                    {fill(tt.orderNo, { n: sale.number })}
                    {voided ? <span className="ms-2 rounded bg-danger-soft px-2 text-base font-semibold text-danger">{tt.voided}</span> : null}
                  </div>
                  <div className="text-base text-ink-3">
                    {clock(sale.occurredAt)} · {sale.payment === "mobile" ? sale.mobileApp || t.payMobile : sale.payment === "credit" ? sale.customerName ?? t.payCredit : t.payCash}
                  </div>
                </div>
                <bdi className={`text-lg font-bold ${voided ? "text-ink-3 line-through" : ""}`}>{money(sale.total, language)}</bdi>
                <div className="flex gap-2">
                  <Button onClick={() => onReceipt(sale.id)}>{tt.receiptTitle}</Button>
                  {!voided ? (
                    <>
                      <Button
                        disabled={readOnly}
                        onClick={() =>
                          void machine.reopenSale(sale.id, tt.reopenReason).then((answer) => {
                            if (said(answer) && answer.ok) onReopened(answer.value);
                          })
                        }
                      >
                        {tt.reopen}
                      </Button>
                      <Button disabled={readOnly} onClick={() => setDeleting(sale)}>
                        {tt.deleteSale}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {deleting ? (
        <Confirm
          title={fill(tt.deleteSaleTitle, { n: deleting.number })}
          body={tt.deleteSaleBody}
          yes={tt.deleteSale}
          no={t.cancel}
          onNo={() => setDeleting(null)}
          onYes={() => {
            const id = deleting.id;
            setDeleting(null);
            void machine.voidSale(id, tt.deleteReason).then((answer) => {
              said(answer);
              reload();
              onChanged();
            });
          }}
        />
      ) : null}
    </Dialog>
  );
}

/*
 * The end of the day, as the owner's app showed it: what came in, how many
 * orders, what sold most, the average order, how it was paid and how it was
 * served. Closing the day itself is done in Caisse, where the drawer is
 * counted; nothing here erases anything.
 */
export function EndOfDay({ configuration, t, tt, onClose }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; onClose: () => void }) {
  const language = configuration.language.app;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [services, setServices] = useState<{ service: string; count: number; total: number }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const today = periodOf("today");
    void machine.reportSummary(today).then((answer) => answer.ok && setSummary(answer.value));
    void machine.reportTop(today).then((answer) => answer.ok && setTop(answer.value));
    void machine.servicesBetween(today.from, today.to).then((answer) => answer.ok && setServices(answer.value));
  }, []);

  const plain = (minor: number) => formatMoney(minor, language);
  const serviceName = (service: string) => (service === "dine_in" ? tt.dineIn : service === "takeaway" ? tt.takeawayShort : tt.deliveryShort);
  const best = [...top].sort((a, b) => b.quantity - a.quantity)[0];

  const rows: [string, string, boolean?][] = summary
    ? [
        [tt.revenue, plain(summary.net), true],
        [tt.orderCount, String(summary.count)],
        ...(best ? ([[tt.topItem, `${best.name} (${fill(tt.timesOrdered, { count: formatQuantity(best.quantity, language) })})`]] as [string, string][]) : []),
        [tt.averageBasket, plain(summary.average)],
        [t.payCash, plain(summary.byPayment.cash)],
        ...summary.byApp.map((row) => [row.app || t.payMobile, plain(row.total)] as [string, string]),
        ...(summary.byPayment.credit !== 0 ? ([[tt.onAccounts, plain(summary.byPayment.credit)]] as [string, string][]) : []),
        ...services.map((row) => [`${serviceName(row.service)} (${row.count})`, plain(row.total)] as [string, string]),
      ]
    : [];

  const printable = (): PrintedTable => ({
    title: `${tt.endTitle} ${localDay()}`,
    header: [tt.endTitle, tt.colAmount],
    align: ["start", "end"],
    rows: rows.map(([label, value]) => [label, value]),
    totals: null,
  });

  return (
    <Dialog
      title={tt.endTitle}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            disabled={!summary}
            onClick={() => void machine.printList(printable(), `${tt.endTitle}-${localDay()}`).then((answer) => setProblem(answer.ok ? null : t.listPrintFailed))}
          >
            {tt.printIt}
          </Button>
          <Button
            kind="primary"
            onClick={() => {
              onClose();
              openSection("cash");
            }}
          >
            {tt.closeTill}
          </Button>
        </div>
      }
    >
      {summary ? (
        <div className="text-base">
          <div className="text-center">
            <div className="text-ink-3">{tt.revenue}</div>
            <bdi className="text-4xl font-bold">{money(summary.net, language)}</bdi>
          </div>
          <dl className="mt-5 divide-y divide-line border-y border-line">
            <Line label={tt.orderCount} value={String(summary.count)} />
            {best ? (
              <Line
                label={tt.topItem}
                value={best.name}
                note={fill(tt.timesOrdered, { count: formatQuantity(best.quantity, language) })}
              />
            ) : null}
            <Line label={tt.averageBasket} value={money(summary.average, language)} />
          </dl>
          <h3 className="mt-5 font-semibold">{tt.paymentDetails}</h3>
          <dl className="mt-1 divide-y divide-line">
            <Line label={t.payCash} value={money(summary.byPayment.cash, language)} />
            {summary.byApp.map((row) => (
              <Line key={row.app} label={row.app || t.payMobile} value={money(row.total, language)} />
            ))}
            {summary.byPayment.credit !== 0 ? <Line label={tt.onAccounts} value={money(summary.byPayment.credit, language)} strong="danger" /> : null}
          </dl>
          {services.length > 0 ? (
            <>
              <h3 className="mt-5 font-semibold">{tt.byService}</h3>
              <dl className="mt-1 divide-y divide-line">
                {services.map((row) => (
                  <Line key={row.service} label={`${serviceName(row.service)} (${row.count})`} value={money(row.total, language)} />
                ))}
              </dl>
            </>
          ) : null}
          <p className="mt-5 text-ink-3">{tt.endHint}</p>
          {problem ? (
            <div className="mt-3">
              <Notice kind="problem" text={problem} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

function Line({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: "danger" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-end">
        <bdi className={`font-bold ${strong === "danger" ? "text-danger" : ""}`}>{value}</bdi>
        {note ? <div className="text-ink-3">{note}</div> : null}
      </dd>
    </div>
  );
}

/* A menu item added or changed right from the counter: its name, its price, its category. */
export function ItemEditor({
  t,
  tt,
  item,
  category,
  categories,
  onClose,
  onSaved,
}: {
  t: ScreensCopy;
  tt: TradesCopy;
  item: Product | null;
  category: string;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(moneyText(item?.salePrice));
  const [group, setGroup] = useState(item?.category ?? category);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const minor = price.trim() ? parseMoney(price) : null;
  const ready = name.trim() !== "" && minor !== null;

  async function save() {
    if (!ready || minor === null) return;
    const input = { name, salePrice: minor, category: group.trim() || null };
    const answer = item ? await machine.updateProduct(item.id, input) : await machine.addProduct({ ...input, tracked: false });
    if (!answer.ok) {
      setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    onSaved();
  }

  return (
    <Dialog
      title={item ? tt.editItem : tt.newItem}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          {item ? (
            <Button kind="quiet" onClick={() => setRemoving(true)}>
              {tt.deleteItem}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button onClick={onClose}>{t.cancel}</Button>
            <Button kind="primary" disabled={!ready} onClick={() => void save()}>
              {t.save}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={tt.itemName} value={name} onChange={setName} autoFocus onEnter={() => void save()} />
        <Field label={tt.itemPrice} value={price} onChange={setPrice} kind="amount" error={price.trim() && minor === null ? t.badAmount : null} onEnter={() => void save()} />
        <label className="block">
          <span className="text-base text-ink-2">{t.colCategory}</span>
          <input
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            list="counter-categories"
            dir="auto"
            className="mt-1 min-h-[48px] w-full rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink"
          />
          <datalist id="counter-categories">
            {categories.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>
        {problem ? <Notice kind="problem" text={problem} /> : null}
      </div>
      {removing && item ? (
        <Confirm
          title={fill(tt.deleteItemTitle, { name: item.name })}
          body={tt.deleteItemBody}
          yes={tt.deleteItem}
          no={t.cancel}
          onNo={() => setRemoving(false)}
          onYes={() => {
            setRemoving(false);
            void machine.archiveProduct(item.id).then((answer) => {
              if (answer.ok) onSaved();
              else setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
            });
          }}
        />
      ) : null}
    </Dialog>
  );
}
