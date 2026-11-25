import { useCallback, useEffect, useMemo, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type CashMovement } from "../bridge";
import type { ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { periodOf } from "./reports";
import { Button, Choices, Confirm, Empty, Field, Notice, ScreenHeader, day, money, parseMoney, when, useDataTick } from "../ui";

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
  const [removing, setRemoving] = useState<CashMovement | null>(null);
  const period = useMemo(() => periodOf(range), [range]);

  const dataTick = useDataTick();
  const reload = useCallback(() => {
    void machine.cashbookBetween(period.from, period.to).then((answer) => answer.ok && setRows(answer.value.filter((row) => row.reason === "expense")));
  }, [period]);
  useEffect(reload, [reload, dataTick]);

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
            <Button kind="primary" locked={readOnly} disabled={!minor} onClick={() => void save()}>
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
                  <span className="flex shrink-0 items-center gap-3">
                    <bdi className="font-semibold">{money(row.amount, language)}</bdi>
                    <Button kind="quiet" locked={readOnly} onClick={() => setRemoving(row)}>
                      {t.deleteLine}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {removing ? (
            <Confirm
              title={t.deleteLineTitle}
              body={t.deleteMoveBody}
              yes={t.deleteLine}
              no={t.cancel}
              onNo={() => setRemoving(null)}
              onYes={() => {
                const id = removing.id;
                setRemoving(null);
                void machine.deleteCashMovement(id).then((answer) => {
                  setMessage(answer.ok ? { text: t.deleteDone, kind: "done" } : { text: answer.reason === "read_only" ? t.readOnly : t.notSaved, kind: "problem" });
                  reload();
                });
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
