import { useCallback, useEffect, useState } from "react";
import type { AppLanguage, Configuration } from "@app-ui/config";
import { machine, type CashSession } from "../bridge";
import { Dialog } from "../dialog";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Field, Notice, ScreenHeader, day, localDay, money, parseMoney, useDataTick } from "../ui";
import { EndOfDayButton } from "./end-of-day";

/*
 * The drawer, in three things a cashier understands at a glance: how much
 * money should be in it now, a way to take money out or put money in, and
 * one button to count it at night. The drawer opens by itself and closing it
 * opens the next day's, so there is nothing else to do. What the figure is
 * made of is one plain sentence under it, never a row of boxes to add up.
 */

export function Cash({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const language = configuration.language.app;
  const [current, setCurrent] = useState<CashSession | null | undefined>(undefined);
  const [history, setHistory] = useState<CashSession[]>([]);
  const [result, setResult] = useState<CashSession | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [moving, setMoving] = useState<"in" | "out" | null>(null);
  const [counting, setCounting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const dataTick = useDataTick();
  const reload = useCallback(() => {
    void machine.cashCurrent().then((answer) => setCurrent(answer.ok ? answer.value : null));
    void machine.cashHistory().then((answer) => answer.ok && setHistory(answer.value));
  }, []);

  useEffect(() => {
    reload();
    /* The figure follows the sales while this screen is open. */
    const timer = setInterval(reload, 15_000); // not-a-rule: a glance, not a feed
    return () => clearInterval(timer);
  }, [reload, dataTick]);

  async function openDrawer() {
    setProblem(null);
    setResult(null);
    const answer = await machine.cashOpen();
    if (!answer.ok) setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
    reload();
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t.cashTitle} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
        <div className="max-w-xl">
          {result ? (
            <div className="mb-6">
              <Verdict session={result} configuration={configuration} t={t} tt={tt} language={language} />
            </div>
          ) : null}
          {problem ? <div className="mb-4"><Notice kind="problem" text={problem} /></div> : null}

          {current === undefined ? null : current === null ? (
            <div className="rounded-lg border-2 border-line p-6">
              <h2 className="text-xl font-semibold">{t.cashClosed}</h2>
              <p className="mt-2 text-base leading-relaxed text-ink-2">{t.cashClosedBody}</p>
              {readOnly ? null : (
                <div className="mt-4">
                  <Button kind="primary" onClick={() => void openDrawer()}>
                    {t.openCash}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-ink p-6 text-on-ink">
                <div className="text-lg">{t.inDrawer}</div>
                <div className="mt-1 text-4xl font-bold">
                  <bdi>{money(current.expected, language)}</bdi>
                </div>
                <p className="mt-3 text-base leading-relaxed opacity-80">{madeOf(current, t, language)}</p>
              </div>

              {done ? <div className="mt-4"><Notice kind="done" text={done} /></div> : null}

              {readOnly ? null : (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Button big wide onClick={() => { setDone(null); setMoving("out"); }}>
                      {tt.cashOut}
                    </Button>
                    <Button big wide onClick={() => { setDone(null); setMoving("in"); }}>
                      {tt.cashIn}
                    </Button>
                  </div>
                  <div className="mt-3">
                    <Button kind="primary" big wide onClick={() => { setDone(null); setResult(null); setCounting(true); }}>
                      {t.closeCash}
                    </Button>
                    <p className="mt-2 text-base text-ink-3">{t.closeHint}</p>
                  </div>
                </>
              )}
            </>
          )}

          <h2 className="mt-8 text-xl font-semibold">{t.pastDays}</h2>
          {history.length === 0 ? (
            <p className="mt-2 text-base text-ink-3">{t.noClosings}</p>
          ) : (
            <ul className="mt-2">
              {history.map((session) => (
                <li key={session.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-base">
                  <span>
                    <bdi className="block">{day(localDay(0, new Date(session.closedAt ?? session.openedAt)), language)}</bdi>
                    <span className="block text-ink-3">
                      {fill(t.countedLine, { amount: money(session.counted ?? 0, language) })}
                      {session.otherDevice ? ` · ${t.otherDevice}` : ""}
                    </span>
                  </span>
                  <span className={`text-end ${session.difference ? "font-bold" : ""}`}>{dayResult(session, t, language)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {moving ? (
        <MoveDialog
          direction={moving}
          t={t}
          tt={tt}
          onClose={() => setMoving(null)}
          onSaved={(text) => {
            setMoving(null);
            setDone(text);
            reload();
          }}
        />
      ) : null}
      {counting ? (
        <CountDialog
          t={t}
          onClose={() => setCounting(false)}
          onClosed={(session) => {
            setCounting(false);
            setResult(session);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

/* What the figure is made of, in one line, naming only what happened today. */
function madeOf(session: CashSession, t: ScreensCopy, language: AppLanguage): string {
  const parts = [
    session.openingFloat > 0 ? `${t.openingFloat} ${money(session.openingFloat, language)}` : null,
    session.cashSales !== 0 ? fill(t.drawerSales, { amount: money(session.cashSales, language) }) : null,
    session.cashPayments !== 0 ? fill(t.drawerDebts, { amount: money(session.cashPayments, language) }) : null,
    session.cashIn > 0 ? fill(t.drawerAdded, { amount: money(session.cashIn, language) }) : null,
    session.cashOut > 0 ? fill(t.drawerTaken, { amount: money(session.cashOut, language) }) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : t.drawerNothing;
}

function dayResult(session: CashSession, t: ScreensCopy, language: AppLanguage): string {
  const difference = session.difference ?? 0;
  if (difference === 0) return t.dayExact;
  return fill(difference < 0 ? t.dayShort : t.dayOver, { amount: money(Math.abs(difference), language) });
}

function Verdict({ session, configuration, t, tt, language }: { session: CashSession; configuration: Configuration; t: ScreensCopy; tt: TradesCopy; language: AppLanguage }) {
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
        {t.colExpected} <bdi>{money(session.expected, language)}</bdi> · {t.colCounted} <bdi>{money(session.counted ?? 0, language)}</bdi>
      </div>
      <div className="mt-2 text-base font-semibold">{t.nextOpened}</div>
      {/* The day just closed, as a page to print or keep. */}
      <div className="mt-4 text-ink [&_button]:bg-surface">
        <EndOfDayButton configuration={configuration} t={t} tt={tt} />
      </div>
    </div>
  );
}

/*
 * Money that leaves or enters the drawer without being a sale. Taken out, it
 * is either spent (a bill, a purchase: an expense in the reports) or taken
 * away (to the bank, by the owner: not an expense). Put in, it is just money
 * added. A note may say what for.
 */
function MoveDialog({
  direction,
  t,
  tt,
  onClose,
  onSaved,
}: {
  direction: "in" | "out";
  t: ScreensCopy;
  tt: TradesCopy;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [kind, setKind] = useState<"expense" | "withdrawal">("expense");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const minor = amount.trim() ? parseMoney(amount) : null;
  const reason = direction === "in" ? "float_added" : kind;

  async function save() {
    if (!minor) return;
    const answer = await machine.cashbookAdd({
      direction,
      amount: minor,
      reason,
      note,
      category: reason === "expense" ? tt.cashMoveReasons.split("|")[0] : null,
    });
    if (!answer.ok) {
      setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    onSaved(tt.cashMoveSaved);
  }

  return (
    <Dialog
      title={direction === "in" ? tt.cashIn : tt.cashOut}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t.cancel}</Button>
          <Button kind="primary" disabled={!minor} onClick={() => void save()}>
            {t.save}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={tt.amount} value={amount} onChange={setAmount} kind="amount" autoFocus error={amount.trim() && minor === null ? t.badAmount : null} onEnter={() => void save()} />
        {direction === "out" ? (
          <div>
            <div className="mb-1 text-base text-ink-2">{tt.cashMoveWhat}</div>
            {/* One under the other, so each says in full what it is, even on a phone. */}
            <div className="grid gap-2" role="radiogroup" aria-label={tt.cashMoveWhat}>
              {(
                [
                  { value: "expense", label: tt.cashOutExpense },
                  { value: "withdrawal", label: tt.cashOutWithdrawal },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={kind === option.value}
                  onClick={() => setKind(option.value)}
                  className={`min-h-[48px] rounded-lg px-4 text-start text-base ${
                    kind === option.value ? "bg-ink font-semibold text-on-ink" : "border-2 border-line-strong bg-surface text-ink"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <Field label={t.note} value={note} onChange={setNote} onEnter={() => void save()} />
        {problem ? <Notice kind="problem" text={problem} /> : null}
      </div>
    </Dialog>
  );
}

/* Counting at night: one figure, typed once. The next day opens by itself. */
function CountDialog({ t, onClose, onClosed }: { t: ScreensCopy; onClose: () => void; onClosed: (session: CashSession) => void }) {
  const [counted, setCounted] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const countedMinor = counted.trim() ? parseMoney(counted) : null;

  async function close() {
    if (countedMinor === null) return;
    const answer = await machine.cashClose(countedMinor, "");
    if (!answer.ok) {
      setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    onClosed(answer.value);
  }

  return (
    <Dialog
      title={t.closeCash}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t.cancel}</Button>
          <Button kind="primary" disabled={countedMinor === null} onClick={() => void close()}>
            {t.closeCash}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-base leading-relaxed text-ink-2">{t.closeBody}</p>
        <Field
          label={t.countedCash}
          value={counted}
          onChange={setCounted}
          kind="amount"
          autoFocus
          error={counted.trim() && countedMinor === null ? t.badAmount : null}
          onEnter={() => void close()}
        />
        {problem ? <Notice kind="problem" text={problem} /> : null}
      </div>
    </Dialog>
  );
}
