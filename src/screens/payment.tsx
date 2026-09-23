import { useEffect, useState } from "react";
import type { AppLanguage } from "@app-ui/config";
import { machine, type Customer, type NewSale } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import { Button, Choices, Field, Notice, money, parseMoney } from "../ui";

/*
 * Taking the money, the same way on every screen that does it: a table's
 * bill, a bakery order collected, a hotel guest leaving, a bus ticket, a
 * parcel handed over. Cash with the change worked out, a mobile app by name,
 * or credit to a named customer.
 *
 * One component, so a cashier who has paid out a table knows how to check
 * out a guest.
 */

export const APPS = ["Bankily", "Masrvi", "Sedad", "Click", "BimBank"]; // not-a-rule: the apps the old till offered, the ones Mauritanian shops take

export type PaymentChoice = Omit<NewSale, "lines" | "reference" | "prepaid">;

export function PaymentBox({
  total,
  t,
  language,
  creditEnabled,
  readOnly,
  actionLabel,
  onPay,
  problem,
}: {
  /** What is to be paid now, after any deposit or advance. */
  total: number;
  t: ScreensCopy;
  language: AppLanguage;
  creditEnabled: boolean;
  readOnly: boolean;
  /** The button's words, with {amount} filled in. */
  actionLabel: string;
  onPay: (choice: PaymentChoice) => Promise<void>;
  problem?: string | null;
}) {
  const [payment, setPayment] = useState<"cash" | "mobile" | "credit">("cash");
  const [app, setApp] = useState(APPS[0]);
  const [otherApp, setOtherApp] = useState("");
  const [received, setReceived] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);

  const receivedMinor = payment === "cash" && received.trim() ? parseMoney(received) : null;
  const receivedBad = payment === "cash" && received.trim() !== "" && receivedMinor === null;
  const short = receivedMinor !== null && receivedMinor < total ? total - receivedMinor : 0;
  const ready = !busy && !readOnly && !receivedBad && short === 0 && (payment !== "credit" || customer !== null);

  async function go() {
    if (!ready) return;
    setBusy(true);
    await onPay({
      payment,
      received: receivedMinor,
      mobileApp: payment === "mobile" ? (app === "other" ? otherApp.trim() || null : app) : null,
      customerId: payment === "credit" ? (customer?.id ?? null) : null,
    });
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <Choices<"cash" | "mobile" | "credit">
        value={payment}
        onChange={setPayment}
        options={[
          { value: "cash", label: t.payCash },
          { value: "mobile", label: t.payMobile },
          ...(creditEnabled ? [{ value: "credit" as const, label: t.payCredit }] : []),
        ]}
      />
      {payment === "cash" && total > 0 ? (
        <div>
          <Field label={t.received} value={received} onChange={setReceived} kind="amount" error={receivedBad ? t.badAmount : null} />
          {receivedMinor !== null && !receivedBad ? (
            <p className="mt-2 text-lg font-semibold">
              {short > 0 ? fill(t.notEnough, { amount: money(short, language) }) : `${t.change} : ${money(receivedMinor - total, language)}`}
            </p>
          ) : null}
        </div>
      ) : null}
      {payment === "mobile" ? (
        <div className="space-y-2">
          <Choices<string> value={app} onChange={setApp} options={[...APPS.map((name) => ({ value: name, label: name })), { value: "other", label: t.otherApp }]} />
          {app === "other" ? <Field label={t.mobileApp} value={otherApp} onChange={setOtherApp} /> : null}
        </div>
      ) : null}
      {payment === "credit" ? <CustomerPicker t={t} language={language} chosen={customer} onChoose={setCustomer} /> : null}
      {problem ? <Notice kind="problem" text={problem} /> : null}
      {readOnly ? <Notice kind="problem" text={t.readOnly} /> : null}
      <Button kind="primary" big wide disabled={!ready} onClick={() => void go()}>
        {busy ? t.charging : fill(actionLabel, { amount: money(total, language) })}
      </Button>
    </div>
  );
}

/** The sentence for a refused payment, whatever screen asked. */
export function paymentProblem(reason: string, t: ScreensCopy): string {
  if (reason === "credit_limit") return t.creditLimit;
  if (reason === "no_customer") return t.needCustomer;
  if (reason === "read_only") return t.readOnly;
  return t.saleRefused;
}

/*
 * Who will pay later. Found by name or phone, or created on the spot: the
 * customer is at the counter, and sending the cashier to another screen to
 * create him first is how credit ends up written on paper instead.
 */
export function CustomerPicker({
  t,
  language,
  chosen,
  onChoose,
}: {
  t: ScreensCopy;
  language: AppLanguage;
  chosen: Customer | null;
  onChoose: (customer: Customer | null) => void;
}) {
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<Customer[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      void machine.customers(term).then((answer) => setFound(answer.ok ? answer.value.slice(0, 6) : []));
    }, 120); // not-a-rule: typing delay
    return () => clearTimeout(timer);
  }, [term]);

  if (chosen) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-black p-3">
        <span>
          <span className="block text-base font-semibold">{chosen.name}</span>
          {chosen.balance > 0 ? (
            <span className="block text-base text-black/60">{fill(t.customerOwes, { amount: money(chosen.balance, language) })}</span>
          ) : null}
        </span>
        <Button kind="quiet" onClick={() => onChoose(null)}>
          {t.cancel}
        </Button>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="space-y-2 rounded-lg border-2 border-black/15 p-3">
        <Field label={t.customerName} value={name} onChange={setName} autoFocus />
        <Field label={t.customerPhone} value={phone} onChange={setPhone} ltr />
        {problem ? <Notice kind="problem" text={problem} /> : null}
        <div className="flex gap-2">
          <Button onClick={() => setCreating(false)}>{t.cancel}</Button>
          <Button
            kind="primary"
            disabled={!name.trim()}
            onClick={() => {
              void machine.addCustomer({ name, phone }).then(async (answer) => {
                if (!answer.ok) {
                  setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
                  return;
                }
                const detail = await machine.customerDetail(answer.value);
                if (detail.ok) onChoose(detail.value.customer);
              });
            }}
          >
            {t.save}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Field label={t.chooseCustomer} value={term} onChange={setTerm} placeholder={t.searchCustomer} />
      <ul className="max-h-[180px] overflow-y-auto">
        {found.map((customer) => (
          <li key={customer.id}>
            <button
              type="button"
              onClick={() => onChoose(customer)}
              className="flex min-h-[48px] w-full items-center justify-between border-b border-black/10 px-2 text-start text-base"
            >
              <span>{customer.name}</span>
              {customer.balance > 0 ? <bdi className="text-black/60">{money(customer.balance, language)}</bdi> : null}
            </button>
          </li>
        ))}
      </ul>
      <Button onClick={() => { setCreating(true); setName(term); }}>{t.newCustomer}</Button>
    </div>
  );
}
