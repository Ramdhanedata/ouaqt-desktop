import { useCallback, useEffect, useState } from "react";
import type { AppLanguage, Configuration } from "@app-ui/config";
import { machine, type Customer, type LedgerLine } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import { Button, Choices, Empty, Field, Notice, Panel, ScreenHeader, Stat, money, moneyText, parseMoney, when } from "../ui";

/*
 * Customers who buy on credit, and what each one owes.
 *
 * The notebook behind the counter, kept honestly: those who owe are at the
 * top with the largest debt first, every figure opens onto the lines that
 * make it up, and a payment is one field and one button.
 */

export function Customers({ configuration, t, readOnly }: { configuration: Configuration; t: ScreensCopy; readOnly: boolean }) {
  const language = configuration.language.app;
  const limits = configuration.common.credit.limitPerCustomer;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => {
    void machine.customers(term).then((answer) => answer.ok && setCustomers(answer.value));
  }, [term]);

  useEffect(() => {
    const timer = setTimeout(reload, 120); // not-a-rule: typing delay
    return () => clearTimeout(timer);
  }, [reload]);

  const owing = customers.filter((customer) => customer.balance > 0);
  const owed = owing.reduce((sum, customer) => sum + customer.balance, 0);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t.customersTitle}>
        <Button kind="primary" disabled={readOnly} onClick={() => setCreating(true)}>
          {t.newCustomer}
        </Button>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t.owedTotal} value={money(owed, language)} note={fill(t.owedNote, { count: owing.length })} strong />
        </div>

        <div className="mt-4">
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t.searchCustomer}
            aria-label={t.search}
            className="min-h-[48px] w-full rounded-lg border-2 border-line-strong px-4 text-base outline-none focus:border-ink"
          />
        </div>

        {customers.length === 0 ? (
          term.trim() ? <Empty title={t.noMatch} /> : <Empty title={t.noCustomers} body={t.noCustomersBody} />
        ) : (
          <ul className="mt-4">
            {customers.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  onClick={() => setOpen(customer.id)}
                  className="flex min-h-[64px] w-full items-center justify-between gap-4 border-b border-line px-2 py-3 text-start hover:bg-hover"
                >
                  <span>
                    <span className="block text-lg font-semibold">{customer.name}</span>
                    <span className="block text-base text-ink-3">
                      {customer.phone ? <bdi dir="ltr">{customer.phone}</bdi> : null}
                      {customer.lastActivity ? <> · <bdi>{when(customer.lastActivity, language)}</bdi></> : null}
                    </span>
                  </span>
                  <span className="text-end">
                    {customer.balance > 0 ? (
                      <bdi className="text-xl font-bold">{money(customer.balance, language)}</bdi>
                    ) : (
                      <span className="text-base text-ink-3">{t.settled}</span>
                    )}
                    {limits && customer.creditLimit !== null ? (
                      <span className="block text-base text-ink-3">
                        {t.creditLimitField} : <bdi>{money(customer.creditLimit, language)}</bdi>
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open ? (
        <CustomerPanel id={open} t={t} language={language} limits={limits} readOnly={readOnly} onClose={() => setOpen(null)} onChanged={reload} />
      ) : null}
      {creating ? (
        <CustomerForm
          t={t}
          limits={limits}
          initial={null}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            reload();
            if (id) setOpen(id);
          }}
        />
      ) : null}
    </div>
  );
}

function CustomerForm({
  t,
  limits,
  initial,
  onClose,
  onSaved,
}: {
  t: ScreensCopy;
  limits: boolean;
  initial: Customer | null;
  onClose: () => void;
  onSaved: (id: string | null) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [limit, setLimit] = useState(moneyText(initial?.creditLimit));
  const [note, setNote] = useState(initial?.note ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const limitMinor = limit.trim() ? parseMoney(limit) : null;
  const limitBad = limit.trim() !== "" && limitMinor === null;

  async function save() {
    if (!name.trim() || limitBad) return;
    const input = { name, phone, note, creditLimit: limits ? limitMinor : (initial?.creditLimit ?? null) };
    const answer = initial ? await machine.updateCustomer(initial.id, input) : await machine.addCustomer(input);
    if (!answer.ok) {
      setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    onSaved(initial ? initial.id : (answer.value as string));
  }

  return (
    <Panel
      title={initial ? initial.name : t.newCustomer}
      onClose={onClose}
      closeLabel={t.close}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t.cancel}</Button>
          <Button kind="primary" disabled={!name.trim() || limitBad} onClick={() => void save()}>
            {t.save}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={t.customerName} value={name} onChange={setName} autoFocus />
        <Field label={t.customerPhone} value={phone} onChange={setPhone} ltr />
        {limits ? (
          <Field label={t.creditLimitField} value={limit} onChange={setLimit} kind="amount" hint={t.creditLimitHint} error={limitBad ? t.badAmount : null} />
        ) : null}
        <Field label={t.note} value={note} onChange={setNote} />
        {problem ? <Notice kind="problem" text={problem} /> : null}
      </div>
    </Panel>
  );
}

function CustomerPanel({
  id,
  t,
  language,
  limits,
  readOnly,
  onClose,
  onChanged,
}: {
  id: string;
  t: ScreensCopy;
  language: AppLanguage;
  limits: boolean;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<LedgerLine[]>([]);
  const [amount, setAmount] = useState("");
  const [how, setHow] = useState<"cash" | "mobile">("cash");
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    void machine.customerDetail(id).then((answer) => {
      if (!answer.ok) return;
      setCustomer(answer.value.customer);
      setLedger(answer.value.ledger);
    });
  }, [id]);

  useEffect(load, [load]);

  if (!customer) return null;

  const minor = amount.trim() ? parseMoney(amount) : null;
  const bad = amount.trim() !== "" && minor === null;
  const tooMuch = minor !== null && minor > customer.balance;

  async function pay() {
    if (minor === null || minor <= 0 || tooMuch || !customer) return;
    const answer = await machine.recordPayment({ customerId: customer.id, amount: minor, payment: how });
    if (!answer.ok) {
      setNote({ text: answer.reason === "read_only" ? t.readOnly : t.notSaved, kind: "problem" });
      return;
    }
    setAmount("");
    setNote({
      text: answer.value.balance > 0 ? fill(t.paymentDone, { amount: money(answer.value.balance, language) }) : t.paymentSettled,
      kind: "done",
    });
    load();
    onChanged();
  }

  if (editing) {
    return (
      <CustomerForm
        t={t}
        limits={limits}
        initial={customer}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          load();
          onChanged();
        }}
      />
    );
  }

  return (
    <Panel title={customer.name} onClose={onClose} closeLabel={t.close}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-base text-ink-3">{t.balance}</div>
          <div className="text-4xl font-bold">
            <bdi>{money(customer.balance, language)}</bdi>
          </div>
          {customer.phone ? <bdi dir="ltr" className="mt-1 block text-base text-ink-3">{customer.phone}</bdi> : null}
        </div>
        <Button disabled={readOnly} onClick={() => setEditing(true)}>
          {t.edit}
        </Button>
      </div>

      {customer.balance > 0 ? (
        <div className="mt-6 space-y-3 rounded-lg border-2 border-line p-4">
          <h3 className="text-lg font-semibold">{t.payment}</h3>
          <Field
            label={t.paymentAmount}
            value={amount}
            onChange={setAmount}
            kind="amount"
            onEnter={() => void pay()}
            error={bad ? t.badAmount : tooMuch ? fill(t.paymentTooMuch, { amount: money(customer.balance, language) }) : null}
          />
          <div>
            <div className="mb-1 text-base text-ink-2">{t.paymentHow}</div>
            <Choices<"cash" | "mobile">
              value={how}
              onChange={setHow}
              options={[
                { value: "cash", label: t.payCash },
                { value: "mobile", label: t.payMobile },
              ]}
            />
          </div>
          <Button kind="primary" disabled={readOnly || minor === null || minor <= 0 || tooMuch} onClick={() => void pay()}>
            {t.save}
          </Button>
        </div>
      ) : null}

      {note ? <div className="mt-4"><Notice kind={note.kind} text={note.text} /></div> : null}

      <h3 className="mt-6 text-lg font-semibold">{t.ledger}</h3>
      {ledger.length === 0 ? (
        <p className="mt-2 text-base text-ink-3">{t.noHistory}</p>
      ) : (
        <ul className="mt-2">
          {ledger.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-3 border-b border-line py-3">
              <span>
                <span className="block text-base">
                  {line.kind === "payment"
                    ? `${t.ledgerPayment}${line.payment === "mobile" ? ` (${t.payMobile})` : line.payment === "cash" ? ` (${t.payCash})` : ""}`
                    : fill(line.kind === "void" ? t.ledgerVoid : t.ledgerSale, { number: line.saleNumber ?? "" })}
                </span>
                <span className="block text-base text-ink-3">
                  <bdi>{when(line.occurredAt, language)}</bdi> · {fill(t.after, { amount: money(line.balanceAfter, language) })}
                </span>
              </span>
              <bdi className="text-lg font-semibold">
                {line.amount > 0 ? "+" : "−"}
                {money(Math.abs(line.amount), language)}
              </bdi>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
