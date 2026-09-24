import { useCallback, useEffect, useState } from "react";
import type { AppLanguage, Configuration } from "@app-ui/config";
import { machine, type CashSession } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Choices, Field, Notice, ScreenHeader, Stat, money, parseMoney, when } from "../ui";

/*
 * The drawer, opened in the morning and counted at night.
 *
 * The cashier types two numbers a day: the float, and what he counted. The
 * rest is worked out from the records and shown as a sum he can check with a
 * finger: float, plus cash sales, plus debts paid in cash, is what the drawer
 * should hold. The difference is then said in words, never as a red number
 * nobody explains.
 */

export function Cash({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const language = configuration.language.app;
  const [current, setCurrent] = useState<CashSession | null | undefined>(undefined);
  const [history, setHistory] = useState<CashSession[]>([]);
  const [float, setFloat] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<CashSession | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(() => {
    void machine.cashCurrent().then((answer) => setCurrent(answer.ok ? answer.value : null));
    void machine.cashHistory().then((answer) => answer.ok && setHistory(answer.value));
  }, []);

  useEffect(() => {
    reload();
    /* The figures follow the sales while this screen is open. */
    const timer = setInterval(reload, 15_000); // not-a-rule: a glance, not a feed
    return () => clearInterval(timer);
  }, [reload]);

  const floatMinor = float.trim() ? parseMoney(float) : 0;
  const countedMinor = counted.trim() ? parseMoney(counted) : null;

  async function openDrawer() {
    if (floatMinor === null) return;
    setProblem(null);
    setResult(null);
    const answer = await machine.cashOpen(floatMinor);
    if (!answer.ok) setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
    setFloat("");
    reload();
  }

  async function closeDrawer() {
    if (countedMinor === null) return;
    setProblem(null);
    const answer = await machine.cashClose(countedMinor, note);
    if (!answer.ok) {
      setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    setResult(answer.value);
    setCounted("");
    setNote("");
    reload();
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t.cashTitle} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {result ? (
          <div className="mb-6">
            <Verdict session={result} t={t} language={language} />
          </div>
        ) : null}
        {problem ? <div className="mb-4"><Notice kind="problem" text={problem} /></div> : null}

        {current === undefined ? null : current === null ? (
          <div className="max-w-xl rounded-lg border-2 border-line p-6">
            <h2 className="text-xl font-semibold">{t.cashClosed}</h2>
            <p className="mt-2 text-base leading-relaxed text-ink-2">{t.cashClosedBody}</p>
            <div className="mt-4 flex items-end gap-3">
              <div className="w-[220px]">
                <Field label={t.openingFloat} value={float} onChange={setFloat} kind="amount" onEnter={() => void openDrawer()} error={floatMinor === null ? t.badAmount : null} />
              </div>
              <Button kind="primary" disabled={readOnly || floatMinor === null} onClick={() => void openDrawer()}>
                {t.openCash}
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl">
            <p className="text-lg text-ink-2">{fill(t.openSince, { time: when(current.openedAt, language) })}</p>
            <div className="mt-4 grid grid-cols-4 gap-3">
              <Stat label={t.openingFloat} value={money(current.openingFloat, language)} />
              <Stat label={t.cashSales} value={money(current.cashSales, language)} note={t.cashSalesNote} />
              <Stat label={t.cashPayments} value={money(current.cashPayments, language)} />
              <Stat label={t.expected} value={money(current.expected, language)} strong />
            </div>
            {current.cashIn > 0 || current.cashOut > 0 ? (
              <p className="mt-2 text-base text-ink-2">
                {tt.cashInOut} : +<bdi>{money(current.cashIn, language)}</bdi> / −<bdi>{money(current.cashOut, language)}</bdi>
              </p>
            ) : null}
            {current.byApp.length > 0 ? (
              <div className="mt-4 rounded-lg border-2 border-line p-4">
                <div className="text-base font-semibold">{t.byAppTitle}</div>
                <div className="text-base text-ink-3">{t.byAppNote}</div>
                <ul className="mt-2 space-y-1">
                  {current.byApp.map((row) => (
                    <li key={row.app} className="flex justify-between gap-4 text-base">
                      <span>{row.app || t.otherApp}</span>
                      <bdi className="font-semibold">{money(row.total, language)}</bdi>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <CashMove t={t} tt={tt} readOnly={readOnly} onSaved={reload} />

            <div className="mt-6 rounded-lg border-2 border-line p-6">
              <h2 className="text-xl font-semibold">{t.closeCash}</h2>
              <p className="mt-2 text-base text-ink-2">{t.closeBody}</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Field label={t.countedCash} value={counted} onChange={setCounted} kind="amount" error={counted.trim() && countedMinor === null ? t.badAmount : null} />
                <Field label={t.note} value={note} onChange={setNote} />
              </div>
              <div className="mt-4">
                <Button kind="primary" big disabled={readOnly || countedMinor === null} onClick={() => void closeDrawer()}>
                  {t.closeCash}
                </Button>
              </div>
            </div>
          </div>
        )}

        <h2 className="mt-8 text-xl font-semibold">{t.pastClosings}</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-base text-ink-3">{t.noClosings}</p>
        ) : (
          <table className="mt-3 w-full max-w-4xl text-base">
            <thead>
              <tr className="border-b-2 border-line text-ink-3">
                <th className="py-2 text-start font-normal">{t.colOpened}</th>
                <th className="py-2 text-start font-normal">{t.colClosed}</th>
                <th className="py-2 text-end font-normal">{t.colExpected}</th>
                <th className="py-2 text-end font-normal">{t.colCounted}</th>
                <th className="py-2 text-end font-normal">{t.colDifference}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((session) => (
                <tr key={session.id} className="border-b border-line">
                  <td className="py-3"><bdi>{when(session.openedAt, language)}</bdi></td>
                  <td className="py-3"><bdi>{session.closedAt ? when(session.closedAt, language) : ""}</bdi></td>
                  <td className="py-3 text-end"><bdi>{money(session.expected, language)}</bdi></td>
                  <td className="py-3 text-end"><bdi>{session.counted === null ? "" : money(session.counted, language)}</bdi></td>
                  <td className={`py-3 text-end ${session.difference ? "font-bold" : ""}`}>
                    <bdi>{session.difference === null ? "" : money(session.difference, language)}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Verdict({ session, t, language }: { session: CashSession; t: ScreensCopy; language: AppLanguage }) {
  const difference = session.difference ?? 0;
  const text =
    difference === 0
      ? t.resultExact
      : difference < 0
        ? fill(t.resultShort, { amount: money(-difference, language) })
        : fill(t.resultOver, { amount: money(difference, language) });
  return (
    <div className={`rounded-lg p-6 ${difference === 0 ? "bg-ink text-on-ink" : "border-2 border-ink"}`} role="status">
      <div className="text-2xl font-bold">{text}</div>
      <div className="mt-2 text-base opacity-80">
        {t.colExpected} <bdi>{money(session.expected, language)}</bdi> · {t.colCounted}{" "}
        <bdi>{money(session.counted ?? 0, language)}</bdi>
      </div>
    </div>
  );
}

/*
 * Money that goes into or out of the drawer without being a sale: an
 * electricity bill paid in cash, notes taken to the bank, coins added to the
 * float. Written with its reason, so the count at closing still matches.
 */
function CashMove({ t, tt, readOnly, onSaved }: { t: ScreensCopy; tt: TradesCopy; readOnly: boolean; onSaved: () => void }) {
  const reasons = tt.cashMoveReasons.split("|");
  const [kind, setKind] = useState<"expense" | "withdrawal" | "float_added">("expense");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const minor = amount.trim() ? parseMoney(amount) : null;

  return (
    <div className="mt-6 rounded-lg border-2 border-line p-6">
      <h2 className="text-xl font-semibold">{tt.cashMove}</h2>
      <div className="mt-3">
        <Choices<"expense" | "withdrawal" | "float_added">
          value={kind}
          onChange={setKind}
          options={[
            { value: "expense", label: reasons[0] },
            { value: "withdrawal", label: reasons[1] },
            { value: "float_added", label: reasons[2] },
          ]}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label={tt.amount} value={amount} onChange={setAmount} kind="amount" error={amount.trim() && minor === null ? t.badAmount : null} />
        <Field label={t.note} value={note} onChange={setNote} />
      </div>
      {done ? <div className="mt-3"><Notice kind="done" text={done} /></div> : null}
      <div className="mt-3">
        <Button
          disabled={readOnly || !minor}
          onClick={() =>
            void machine
              .cashbookAdd({ direction: kind === "float_added" ? "in" : "out", amount: minor as number, reason: kind, note, category: kind === "expense" ? reasons[0] : null })
              .then((answer) => {
                if (answer.ok) {
                  setAmount("");
                  setNote("");
                  setDone(tt.cashMoveSaved);
                  onSaved();
                }
              })
          }
        >
          {kind === "float_added" ? tt.cashIn : tt.cashOut}
        </Button>
      </div>
    </div>
  );
}
