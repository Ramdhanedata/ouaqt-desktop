import { useEffect, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type CashSession, type PrintedDay } from "../bridge";
import { dayReport, type DayFacts } from "../day-report";
import { Dialog } from "../dialog";
import { icons } from "../icons";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Field, Notice, localDay, money, moneyText, parseMoney } from "../ui";
import { WhatsappButton } from "../whatsapp-button";
import { workingDay } from "../working-day";

/*
 * The end of the day, as the owner's restaurant app showed it, for every
 * trade: the same button, the same window, the same report on the screen, on
 * paper, as a PDF and on WhatsApp. Then one button closes the day: the drawer
 * is counted, and the till's figures start again at zero for the next one.
 * Nothing is erased; the day stays in Statistiques.
 */

/* Everything the report needs, read fresh each time the window opens. A question that fails leaves its section out. */
async function readFacts(configuration: Configuration): Promise<{ facts: DayFacts; drawer: CashSession | null } | null> {
  /* From midnight, or from the last time the day was closed today. */
  const today = await workingDay();
  const pack = configuration.pack;
  const value = async <T,>(asked: Promise<{ ok: true; value: T } | { ok: false }>): Promise<T | undefined> => {
    const answer = await asked;
    return answer.ok ? answer.value : undefined;
  };
  const [summary, top, cashNow] = await Promise.all([value(machine.reportSummary(today)), value(machine.reportTop(today)), value(machine.cashCurrent())]);
  if (!summary) return null;
  const facts: DayFacts = { summary, top: top ?? [], cash: cashNow ?? null };
  if (pack === "restaurant") facts.services = await value(machine.servicesBetween(today.from, today.to));
  if (pack === "hotel") facts.occupancy = await value(machine.occupancy(localDay(), localDay(1)));
  if (pack === "wash") facts.wash = await value(machine.washReport(today.from, today.to));
  if (pack === "transport") facts.routes = await value(machine.routeTakings(today.from, today.to));
  if (pack === "bakery") facts.baked = await value(machine.bakeryDay());
  if (pack === "warehouse") facts.flows = await value(machine.warehouseFlows(today.from, today.to));
  return { facts, drawer: cashNow ?? null };
}

export function EndOfDay({ configuration, t, tt, onClose }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; onClose: () => void }) {
  const language = configuration.language.app;
  const [report, setReport] = useState<PrintedDay | null>(null);
  const [drawer, setDrawer] = useState<CashSession | null>(null);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const [failed, setFailed] = useState(false);
  /* The report, then the count that closes the day, then the day closed. */
  const [step, setStep] = useState<"report" | "count" | "closed">("report");
  const [counted, setCounted] = useState("");
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState<CashSession | null>(null);
  const countedMinor = counted.trim() ? parseMoney(counted) : null;

  useEffect(() => {
    void readFacts(configuration).then((read) => {
      if (!read) return setFailed(true);
      setReport(dayReport(configuration, t, tt, read.facts));
      setDrawer(read.drawer);
    });
  }, [configuration, t, tt]);

  const startCount = () => {
    setNote(null);
    /* What should be there, written in: a shop that does not count closes with one tap, one that does types over it. */
    setCounted(drawer ? moneyText(drawer.expected) : "");
    setStep("count");
  };

  async function closeDay() {
    if (countedMinor === null || closing) return;
    setClosing(true);
    const answer = await machine.cashClose(countedMinor, "");
    setClosing(false);
    if (!answer.ok) {
      setNote({ text: answer.reason === "read_only" ? t.readOnly : t.notSaved, kind: "problem" });
      return;
    }
    setClosed(answer.value);
    setNote(null);
    setStep("closed");
    /* The till's figures, today's list and every open screen read again: the new day starts at zero. */
    window.dispatchEvent(new Event("ouaqt:data"));
  }

  const print = () => {
    if (!report) return;
    void machine.printDay(report).then((answer) => setNote(answer.ok ? null : { text: tt.endPrintFailed, kind: "problem" }));
  };
  const savePdf = () => {
    if (!report) return;
    void machine.dayPdf(report, `${tt.endTitle}-${localDay()}`).then((answer) => {
      if (!answer.ok) setNote({ text: tt.endPdfFailed, kind: "problem" });
      else if (answer.value !== null) setNote({ text: tt.endPdfSaved, kind: "done" });
    });
  };

  return (
    <Dialog
      title={tt.endTitle}
      onClose={onClose}
      footer={
        <>
        {/* Beside the buttons, not under a long report, where it would be missed. */}
        {note ? (
          <div className="mb-3">
            <Notice kind={note.kind} text={note.text} />
          </div>
        ) : null}
        {step === "report" ? (
          <>
            {/* The report to the owner's phone first: one tap, and WhatsApp opens with it written. */}
            <div className="mb-3">
              <WhatsappButton configuration={configuration} t={t} report={report} wide onSent={(text) => setNote({ text, kind: "done" })} />
            </div>
            <div className="flex flex-wrap justify-end gap-2 max-md:grid max-md:grid-cols-2">
              <Button disabled={!report} onClick={print}>
                {tt.printIt}
              </Button>
              <Button disabled={!report} onClick={savePdf}>
                {tt.endDownloadPdf}
              </Button>
              <div className="max-md:col-span-2 max-md:grid">
                <Button kind="primary" disabled={!report} onClick={startCount}>
                  {tt.closeDay}
                </Button>
              </div>
            </div>
          </>
        ) : step === "count" ? (
          <div className="flex flex-wrap justify-end gap-2 max-md:grid max-md:grid-cols-2">
            <Button onClick={() => setStep("report")}>{t.cancel}</Button>
            <Button kind="primary" disabled={countedMinor === null || closing} onClick={() => void closeDay()}>
              {tt.closeDayConfirm}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end max-md:grid">
            <Button kind="primary" onClick={onClose}>
              {tt.newDay}
            </Button>
          </div>
        )}
        </>
      }
    >
      {failed ? <Notice kind="problem" text={t.notSaved} /> : null}
      {step === "count" ? (
        <div className="space-y-4 text-base">
          <p className="leading-relaxed text-ink-2">{tt.closeDayBody}</p>
          {drawer ? (
            <p className="text-lg font-semibold">
              {fill(tt.closeDayExpected, { amount: money(drawer.expected, language) })}
            </p>
          ) : null}
          <Field
            label={t.countedCash}
            value={counted}
            onChange={setCounted}
            kind="amount"
            autoFocus
            error={counted.trim() && countedMinor === null ? t.badAmount : null}
            onEnter={() => void closeDay()}
          />
        </div>
      ) : step === "closed" ? (
        <div className="py-6 text-center text-base">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
            <icons.check size={28} />
          </div>
          <p className="mt-4 text-lg font-semibold">{tt.closeDayDone}</p>
          {closed && closed.difference !== null && closed.difference !== 0 ? (
            <p className={`mt-2 ${closed.difference < 0 ? "text-danger" : "text-ink-2"}`}>
              {fill(tt.closeDayGap, { amount: `${closed.difference > 0 ? "+" : ""}${money(closed.difference, language)}` })}
            </p>
          ) : null}
        </div>
      ) : report ? (
        <div className="text-base">
          <p className="text-center text-ink-3">{report.date}</p>
          <div className="mt-2 text-center">
            <div className="text-ink-3">{report.totalLabel}</div>
            <bdi className="text-4xl font-bold">{report.total}</bdi>
          </div>
          {report.sections.map((section, index) => (
            <section key={section.heading ?? index}>
              {section.heading ? <h3 className="mt-5 font-semibold">{section.heading}</h3> : null}
              <dl className={`divide-y divide-line ${section.heading ? "mt-1" : "mt-5 border-y border-line"}`}>
                {section.rows.map((row) => (
                  <div key={row.label} className="flex items-baseline justify-between gap-4 py-2">
                    <dt className="min-w-0 text-ink-2">{row.label}</dt>
                    <dd className="shrink-0 text-end">
                      <bdi className="font-bold">{row.value}</bdi>
                      {row.note ? <div className="text-ink-3">{row.note}</div> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="mt-5 text-ink-3">{tt.endHint}</p>
        </div>
      ) : null}
    </Dialog>
  );
}

/*
 * The same action, with the same name, on every trade's main screen and in
 * Caisse. Beside the sale screen's search it is `compact`: on a phone the
 * search keeps the room, and the button takes two short lines and no picture.
 */
export function EndOfDayButton({ configuration, t, tt, compact }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const button = (
    <Button onClick={() => setOpen(true)}>
      <span className="flex items-center gap-2">
        <icons.cash size={20} />
        {tt.endOfDay}
      </span>
    </Button>
  );
  return (
    <>
      {compact ? (
        <div className="shrink-0 max-md:w-[5.75rem] max-md:[&_button]:min-h-[56px] max-md:[&_button]:w-full max-md:[&_button]:px-2 max-md:[&_button]:leading-tight max-md:[&_svg]:hidden">{button}</div>
      ) : (
        button
      )}
      {open ? <EndOfDay configuration={configuration} t={t} tt={tt} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
