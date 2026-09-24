import { useCallback, useEffect, useMemo, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type CashMovement, type Product, type Summary } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { periodOf } from "./reports";
import { Button, Choices, Empty, Field, Notice, ScreenHeader, Stat, day, money, parseMoney, when } from "../ui";

/*
 * The first screen of any business that is none of the others: what today
 * brought in, what the month brought in, what the month cost, what is left,
 * and what needs attention. Everything comes from the same sales and cash
 * book the other screens write, so the dashboard never has its own figures.
 */
export function Dashboard({ configuration, t, tt }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy }) {
  const language = configuration.language.app;
  const features = configuration.features.general;
  const [today, setToday] = useState<Summary | null>(null);
  const [month, setMonth] = useState<Summary | null>(null);
  const [days, setDays] = useState<{ day: string; net: number; count: number }[]>([]);
  const [low, setLow] = useState<Product[]>([]);

  useEffect(() => {
    void machine.reportSummary(periodOf("today")).then((answer) => answer.ok && setToday(answer.value));
    void machine.reportSummary(periodOf("month")).then((answer) => answer.ok && setMonth(answer.value));
    void machine.dailyTotals(30).then((answer) => answer.ok && setDays(answer.value));
    void machine.products().then((all) =>
      setLow(all.filter((product) => product.tracked && product.lowStock !== null && product.onHand <= product.lowStock).slice(0, 8))
    );
  }, []);

  const peak = Math.max(1, ...days.map((one) => one.net));
  const showExpenses = features?.expenses !== false;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.dashboardTitle} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-4 gap-3">
          <Stat label={tt.todaySales} value={money(today?.net ?? 0, language)} note={`${t.salesCount} : ${today?.count ?? 0}`} strong />
          <Stat label={tt.monthSales} value={money(month?.net ?? 0, language)} note={`${t.salesCount} : ${month?.count ?? 0}`} />
          {showExpenses ? <Stat label={tt.monthExpenses} value={money(month?.expenses.total ?? 0, language)} /> : null}
          {showExpenses ? (
            <Stat label={tt.monthLeft} value={money((month?.net ?? 0) - (month?.expenses.total ?? 0), language)} note={tt.leftNote} strong />
          ) : null}
        </div>

        <section className="mt-8">
          <h2 className="text-xl font-semibold">{tt.last30}</h2>
          <div className="mt-3 flex h-[160px] items-end gap-1 rounded-lg border-2 border-line p-3" dir="ltr">
            {days.map((one) => (
              <div key={one.day} className="flex h-full flex-1 flex-col justify-end" title={`${day(one.day, language)} · ${money(one.net, language)}`}>
                <div className="rounded-sm bg-ink" style={{ height: `${Math.max(one.net > 0 ? 2 : 0, (one.net / peak) * 100)}%` }} />
              </div>
            ))}
          </div>
        </section>

        <div className="mt-8 grid grid-cols-2 gap-6">
          {features?.trackStock !== false ? (
            <section>
              <h2 className="text-xl font-semibold">{tt.reorder}</h2>
              {low.length === 0 ? (
                <p className="mt-2 text-base text-ink-3">{tt.nothingToReorder}</p>
              ) : (
                <ul className="mt-2">
                  {low.map((product) => (
                    <li key={product.id} className="flex justify-between border-b border-line py-2 text-base">
                      <span>{product.name}</span>
                      <bdi className="font-semibold">{product.onHand}</bdi>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
          {configuration.common.credit.enabled ? (
            <section>
              <h2 className="text-xl font-semibold">{tt.owedTo}</h2>
              <p className="mt-2 text-2xl font-bold">
                <bdi>{money(month?.owed.total ?? 0, language)}</bdi>
              </p>
              <p className="text-base text-ink-3">{fill(t.owedNote, { count: month?.owed.customers ?? 0 })}</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/*
 * The expenses book: rent, electricity, wages. Each one is written with its
 * category, and paid in cash it comes out of the drawer's expected count.
 */
export function Expenses({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const language = configuration.language.app;
  const categories = tt.categories.split("|");
  const [range, setRange] = useState<"today" | "week" | "month" | "lastMonth">("month");
  const [rows, setRows] = useState<CashMovement[]>([]);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [how, setHow] = useState<"cash" | "mobile">("cash");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const period = useMemo(() => periodOf(range), [range]);

  const reload = useCallback(() => {
    void machine.cashbookBetween(period.from, period.to).then((answer) => answer.ok && setRows(answer.value.filter((row) => row.reason === "expense")));
  }, [period]);
  useEffect(reload, [reload]);

  const minor = amount.trim() ? parseMoney(amount) : null;
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const byCategory = rows.reduce<Record<string, number>>((all, row) => {
    const key = row.category ?? "";
    all[key] = (all[key] ?? 0) + row.amount;
    return all;
  }, {});

  async function save() {
    if (!minor) return;
    const answer = await machine.cashbookAdd({ direction: "out", amount: minor, payment: how, reason: "expense", category, note });
    if (!answer.ok) {
      setMessage({ text: answer.reason === "read_only" ? t.readOnly : t.notSaved, kind: "problem" });
      return;
    }
    setMessage({ text: tt.expenseSaved, kind: "done" });
    setAmount("");
    setNote("");
    reload();
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.expensesTitle} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-3xl rounded-lg border-2 border-line p-4">
          <h2 className="text-lg font-semibold">{tt.newExpense}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label={tt.amount} value={amount} onChange={setAmount} kind="amount" error={amount.trim() && minor === null ? t.badAmount : null} />
            <Field label={t.note} value={note} onChange={setNote} />
          </div>
          <div className="mt-3">
            <div className="mb-1 text-base text-ink-2">{tt.category}</div>
            <Choices<string> value={category} onChange={setCategory} options={categories.map((one) => ({ value: one, label: one }))} />
          </div>
          <div className="mt-3">
            <div className="mb-1 text-base text-ink-2">{tt.paidWith}</div>
            <Choices<"cash" | "mobile"> value={how} onChange={setHow} options={[{ value: "cash", label: t.payCash }, { value: "mobile", label: t.payMobile }]} />
          </div>
          {message ? <div className="mt-3"><Notice kind={message.kind} text={message.text} /></div> : null}
          <div className="mt-4">
            <Button kind="primary" disabled={readOnly || !minor} onClick={() => void save()}>
              {t.save}
            </Button>
          </div>
        </div>

        <div className="mt-8">
          <Choices<"today" | "week" | "month" | "lastMonth">
            value={range}
            onChange={setRange}
            options={[
              { value: "today", label: t.today },
              { value: "week", label: t.week },
              { value: "month", label: t.month },
              { value: "lastMonth", label: t.lastMonth },
            ]}
          />
          <p className="mt-4 text-xl font-bold">
            {tt.expensesTotal} : <bdi>{money(total, language)}</bdi>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(byCategory).map(([key, value]) => (
              <span key={key} className="rounded-lg bg-hover px-3 py-2 text-base">
                {key || t.noCategory} · <bdi>{money(value, language)}</bdi>
              </span>
            ))}
          </div>
          {rows.length === 0 ? (
            <Empty title={tt.noExpenses} />
          ) : (
            <ul className="mt-4">
              {rows.map((row) => (
                <li key={row.id} className="flex justify-between gap-3 border-b border-line py-2 text-base">
                  <span>
                    <b>{row.category ?? t.noCategory}</b>
                    {row.note ? ` · ${row.note}` : ""} · <bdi className="text-ink-3">{when(row.occurredAt, language)}</bdi>
                  </span>
                  <bdi className="font-semibold">{money(row.amount, language)}</bdi>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
