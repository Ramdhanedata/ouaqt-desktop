import { useEffect, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { formatMoney, formatQuantity } from "@app-ui/format";
import { machine, type Product, type PrintedTable, type SaleSummary, type Summary, type TopProduct } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Dialog } from "../dialog";
import { openSection } from "../payment-apps";
import { Button, Confirm, Field, Notice, clock, localDay, money, moneyText, nameOr, parseMoney } from "../ui";
import { periodOf } from "./reports";

/*
 * What opens over the counter: the day's history and a menu item being added
 * or changed. The receipt after a payment is the shared one in ../receipt.tsx,
 * and the end of the day the shared one in ./end-of-day.tsx. Each is a dialog,
 * as in the owner's own app, so the order being taken is still there when it
 * closes.
 */

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
  const minor = price.trim() ? parseMoney(price) : 0;
  const ready = minor !== null;

  async function save() {
    if (!ready || minor === null) return;
    const input = { name: nameOr(t.noName, name), salePrice: minor, category: group.trim() || null };
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
