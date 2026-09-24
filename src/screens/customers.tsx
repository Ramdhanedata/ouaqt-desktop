import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppLanguage, Configuration } from "@app-ui/config";
import { machine, type AccountPeriod, type AccountStatement, type AccountStatus, type Column, type Customer, type LedgerLine, type PrintedTable } from "../bridge";
import { CustomFields, ListTable, customText, labelOf, moneyPlain, saveCustomFields, systemLabels, useListShape, type SystemColumn } from "../columns";
import { fill, type ScreensCopy } from "../i18n/screens";
import { AppPayment, type AppChoice } from "../payment-apps";
import { Button, Choices, Empty, Field, Notice, Panel, ScreenHeader, Stat, day, money, moneyText, parseMoney, when } from "../ui";
import { formatDateTime, formatMoney } from "@app-ui/format";
import type { Billing } from "../../electron/db/customers";

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

  /* Where each billed account stands, beside its balance. */
  const [statuses, setStatuses] = useState<Record<string, AccountStatus>>({});
  useEffect(() => {
    const billed = customers.filter((customer) => customer.billing).map((customer) => customer.id);
    if (billed.length === 0) return setStatuses({});
    void machine.accountStatus(billed).then((answer) => answer.ok && setStatuses(answer.value));
  }, [customers]);

  const { shape, reload: reloadShape } = useListShape("customers");
  const system = useMemo<Record<string, SystemColumn<Customer>>>(
    () => ({
      name: {
        label: t.customerName,
        cell: (customer) => (
          <>
            <div className="text-lg font-semibold">{customer.name}</div>
            {customer.lastActivity ? (
              <div className="text-ink-3">
                <bdi>{when(customer.lastActivity, language)}</bdi>
              </div>
            ) : null}
          </>
        ),
        text: (customer) => customer.name,
        sort: (customer) => customer.name,
      },
      phone: {
        label: t.customerPhone,
        cell: (customer) => (customer.phone ? <bdi dir="ltr">{customer.phone}</bdi> : null),
        text: (customer) => customer.phone ?? "",
        sort: (customer) => customer.phone,
      },
      balance: {
        label: t.balance,
        align: "end",
        cell: (customer) => (
          <>
            {customer.balance > 0 ? (
              <bdi className="text-xl font-bold">{money(customer.balance, language)}</bdi>
            ) : (
              <span className="text-ink-3">{t.settled}</span>
            )}
            {limits && customer.creditLimit !== null ? (
              <span className="block text-ink-3">
                {t.creditLimitField} : <bdi>{money(customer.creditLimit, language)}</bdi>
              </span>
            ) : null}
            {statuses[customer.id] ? (
              <span className="mt-1 block">
                <StatusBadge status={statuses[customer.id]} t={t} />
              </span>
            ) : null}
          </>
        ),
        text: (customer) => (customer.balance > 0 ? moneyPlain(customer.balance, language) : t.settled),
        sort: (customer) => customer.balance,
        total: (rows) => moneyPlain(rows.reduce((sum, customer) => sum + Math.max(customer.balance, 0), 0), language),
      },
    }),
    [t, language, limits, statuses]
  );

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

        <ListTable
          list="customers"
          t={t}
          language={language}
          title={t.customersTitle}
          rows={customers}
          system={system}
          shape={shape}
          onShape={reloadShape}
          onOpen={(customer) => setOpen(customer.id)}
          empty={term.trim() ? <Empty title={t.noMatch} /> : <Empty title={t.noCustomers} body={t.noCustomersBody} />}
        />
      </div>

      {open ? (
        <CustomerPanel
          id={open}
          t={t}
          language={language}
          limits={limits}
          readOnly={readOnly}
          onClose={() => setOpen(null)}
          onChanged={() => {
            reload();
            reloadShape();
          }}
        />
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
            reloadShape();
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
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [billing, setBilling] = useState<Billing | "">(initial?.billing ?? "");
  const [billingStart, setBillingStart] = useState(initial?.billingStart ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const { shape } = useListShape("customers");
  const [custom, setCustom] = useState<Record<string, string> | null>(null);
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const before = (initial && shape?.values[initial.id]) || {};
  const limitMinor = limit.trim() ? parseMoney(limit) : null;
  const limitBad = limit.trim() !== "" && limitMinor === null;

  async function save() {
    if (!name.trim() || limitBad) return;
    const input = {
      name,
      phone,
      note,
      creditLimit: limits ? limitMinor : (initial?.creditLimit ?? null),
      contact,
      billing: billing || null,
      billingStart: billing ? billingStart || null : null,
    };
    const answer = initial ? await machine.updateCustomer(initial.id, input) : await machine.addCustomer(input);
    if (!answer.ok) {
      setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    const id = initial ? initial.id : (answer.value as string);
    const refused = await saveCustomFields("customers", id, t, before, custom ?? before);
    setCustomErrors(refused);
    if (Object.keys(refused).length > 0 && initial) {
      setProblem(t.valueNotSaved);
      return;
    }
    onSaved(id);
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
        <Field label={t.contactLabel} value={contact} onChange={setContact} />
        <label className="block">
          <span className="text-base text-ink-2">{t.billingLabel}</span>
          <select
            value={billing}
            onChange={(event) => setBilling(event.target.value as Billing | "")}
            className="mt-1 block min-h-[48px] w-full rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink"
          >
            <option value="">{t.billingNone}</option>
            {BILLINGS.map((one) => (
              <option key={one} value={one}>
                {billingName(one, t)}
              </option>
            ))}
          </select>
        </label>
        {billing ? <Field label={t.billingStart} value={billingStart} onChange={setBillingStart} kind="date" /> : null}
        <Field label={t.note} value={note} onChange={setNote} />
        <CustomFields
          t={t}
          columns={shape?.columns ?? []}
          values={custom ?? before}
          errors={customErrors}
          onChange={(column, value) => setCustom((current) => ({ ...(current ?? before), [column]: value }))}
        />
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
  const [appChoice, setAppChoice] = useState<AppChoice | null>(null);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const [editing, setEditing] = useState(false);
  const { shape, reload: reloadCustom } = useListShape("customers");

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
    if (minor === null || minor <= 0 || tooMuch || !customer || (how === "mobile" && !appChoice)) return;
    const answer = await machine.recordPayment({
      customerId: customer.id,
      amount: minor,
      payment: how,
      ...(how === "mobile" && appChoice ? { mobileApp: appChoice.name, paymentReference: appChoice.reference } : {}),
    });
    if (!answer.ok) {
      setNote({ text: answer.reason === "read_only" ? t.readOnly : t.notSaved, kind: "problem" });
      return;
    }
    setAmount("");
    setAppChoice(null);
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
          reloadCustom();
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

      {shape ? <OwnValues t={t} language={language} columns={shape.columns} values={shape.values[customer.id] ?? {}} /> : null}
      {customer.contact ? <p className="mt-2 text-base text-ink-2">{t.contactLabel} : {customer.contact}</p> : null}
      {customer.billing ? <Invoices customer={customer} t={t} language={language} /> : null}

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
          {how === "mobile" ? <AppPayment t={t} value={appChoice} onChange={setAppChoice} /> : null}
          <Button
            kind="primary"
            disabled={readOnly || minor === null || minor <= 0 || tooMuch || (how === "mobile" && !appChoice)}
            onClick={() => void pay()}
          >
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
                    ? `${t.ledgerPayment}${line.payment === "mobile" ? ` (${line.mobileApp ?? t.payMobile})` : line.payment === "cash" ? ` (${t.payCash})` : ""}`
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

/* What the owner wrote in his own columns, on the customer's sheet, read-only until Modifier. */
function OwnValues({
  t,
  language,
  columns,
  values,
}: {
  t: ScreensCopy;
  language: AppLanguage;
  columns: Column[];
  values: Record<string, string>;
}) {
  const own = columns.filter((column) => !column.system && !column.hidden && (column.type === "yesno" || values[column.id]));
  if (own.length === 0) return null;
  const labels = systemLabels("customers", t);
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-base">
      {own.map((column) => (
        <div key={column.id}>
          <dt className="text-ink-3">{labelOf(column, labels)}</dt>
          <dd>
            <bdi>{customText(column, values[column.id], t, language)}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

const BILLINGS: Billing[] = ["daily", "weekly", "biweekly", "monthly", "custom"];

export function billingName(billing: Billing, t: ScreensCopy): string {
  return {
    daily: t.billingDaily,
    weekly: t.billingWeekly,
    biweekly: t.billingBiweekly,
    monthly: t.billingMonthly,
    custom: t.billingCustom,
  }[billing];
}

export function StatusBadge({ status, t }: { status: AccountStatus; t: ScreensCopy }) {
  const look = {
    paid: "bg-success-soft text-success",
    partial: "bg-warning-soft text-warning",
    unpaid: "bg-hover text-ink-2",
    overdue: "bg-danger-soft text-danger",
  }[status];
  const label = { paid: t.statusPaid, partial: t.statusPartial, unpaid: t.statusUnpaid, overdue: t.statusOverdue }[status];
  return <span className={`inline-block rounded-md px-2 py-0.5 text-base font-semibold ${look}`}>{label}</span>;
}

/*
 * An account billed by period, as the restaurant app kept companies: where
 * it stands, each period with what was consumed and paid, and each period's
 * invoice to look at or to print.
 */
function Invoices({ customer, t, language }: { customer: Customer; t: ScreensCopy; language: AppLanguage }) {
  const [periods, setPeriods] = useState<AccountPeriod[] | null>(null);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [open, setOpen] = useState<AccountPeriod | null>(null);
  useEffect(() => {
    void machine.accountPeriods(customer.id).then((answer) => answer.ok && setPeriods(answer.value));
    void machine.accountStatus([customer.id]).then((answer) => answer.ok && setStatus(answer.value[customer.id] ?? null));
  }, [customer.id, customer.balance]);

  const used = (periods ?? []).filter((period) => period.consumed !== 0 || period.paid !== 0);
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">
          {t.invoicesTitle} <span className="font-normal text-ink-3">({customer.billing ? billingName(customer.billing, t) : ""})</span>
        </h3>
        {status ? <StatusBadge status={status} t={t} /> : null}
      </div>
      {periods === null ? null : used.length === 0 ? (
        <p className="mt-2 text-base text-ink-3">{t.noInvoices}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-lg border-2 border-line">
          {used.map((period) => (
            <li key={period.from} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="text-base font-semibold">{fill(t.invoicePeriod, { from: day(period.from, language), to: day(period.to, language) })}</div>
                <div className="text-base text-ink-3">
                  {t.consumed} <bdi>{money(period.consumed, language)}</bdi> · {t.paidLabel} <bdi>{money(period.paid, language)}</bdi>
                </div>
              </div>
              <Button onClick={() => setOpen(period)}>{t.openInvoice}</Button>
            </li>
          ))}
        </ul>
      )}
      {open ? <Statement customer={customer} period={open} t={t} language={language} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

function Statement({
  customer,
  period,
  t,
  language,
  onClose,
}: {
  customer: Customer;
  period: AccountPeriod;
  t: ScreensCopy;
  language: AppLanguage;
  onClose: () => void;
}) {
  const [statement, setStatement] = useState<AccountStatement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void machine.accountStatement(customer.id, period.from, period.to).then((answer) => answer.ok && setStatement(answer.value));
  }, [customer.id, period.from, period.to]);

  const title = fill(t.invoiceTitle, { name: customer.name });
  const when_ = fill(t.invoicePeriod, { from: plainDate(period.from, language), to: plainDate(period.to, language) });
  const describe = (line: AccountStatement["lines"][number]) =>
    line.kind === "payment"
      ? `${t.invoicePayment}${line.payment === "mobile" && line.mobileApp ? ` (${line.mobileApp})` : ""}`
      : `${fill(t.invoiceSale, { n: line.saleNumber ?? "" })}${line.employee ? `, ${line.employee}` : ""}`;

  const printable = (): PrintedTable | null =>
    statement
      ? {
          title: `${title} · ${when_}`,
          header: [t.typeDate, t.customer, t.consumed, t.paidLabel],
          align: ["start", "start", "end", "end"],
          rows: [
            [plainDate(period.from, language), t.openingBalance, formatMoney(statement.opening, language), ""],
            ...statement.lines.map((line) => [
              formatDateTime(new Date(line.occurredAt), language),
              describe(line),
              line.kind === "payment" ? "" : formatMoney(line.amount, language),
              line.kind === "payment" ? formatMoney(-line.amount, language) : "",
            ]),
          ],
          totals: [t.closingBalance, formatMoney(statement.closing, language), formatMoney(statement.consumed, language), formatMoney(statement.paid, language)],
        }
      : null;

  return (
    <Panel
      title={title}
      onClose={onClose}
      closeLabel={t.close}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            disabled={!statement}
            onClick={() => {
              const table = printable();
              if (table) void machine.printList(table, `facture-${customer.name}-${period.from}`).then((answer) => setProblem(answer.ok ? null : t.listPrintFailed));
            }}
          >
            {t.printList}
          </Button>
          <Button kind="primary" onClick={onClose}>
            {t.close}
          </Button>
        </div>
      }
    >
      {statement ? (
        <div className="text-base">
          <p className="mb-3 text-lg font-semibold text-ink-2">{when_}</p>
          <dl className="grid grid-cols-2 gap-3">
            <Stat label={t.openingBalance} value={money(statement.opening, language)} />
            <Stat label={t.closingBalance} value={money(statement.closing, language)} strong={statement.closing > 0} />
          </dl>
          <table className="mt-4 w-full">
            <tbody>
              {statement.lines.map((line, index) => (
                <tr key={index} className="border-b border-line">
                  <td className="py-2 pe-3">
                    <div className="font-semibold">{describe(line)}</div>
                    <div className="text-ink-3">
                      <bdi>{when(line.occurredAt, language)}</bdi>
                    </div>
                  </td>
                  <td className={`py-2 text-end font-bold ${line.kind === "payment" ? "text-success" : ""}`}>
                    <bdi>
                      {line.kind === "payment" ? "−" : ""}
                      {money(Math.abs(line.amount), language)}
                    </bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {problem ? (
            <div className="mt-3">
              <Notice kind="problem" text={problem} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function plainDate(date: string, language: AppLanguage): string {
  const [year, month, dayOfMonth] = date.split("-");
  return language === "en" ? date : `${dayOfMonth}/${month}/${year}`;
}

