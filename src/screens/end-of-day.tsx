import { useEffect, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type PrintedDay } from "../bridge";
import { dayReport, type DayFacts } from "../day-report";
import { Dialog } from "../dialog";
import { icons } from "../icons";
import type { ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { openSection } from "../payment-apps";
import { Button, Notice, localDay } from "../ui";
import { periodOf } from "./reports";

/*
 * The end of the day, as the owner's restaurant app showed it, for every
 * trade: the same button, the same window, the same report on the screen, on
 * paper and as a PDF. Closing the day itself is done in Caisse, where the
 * drawer is counted; nothing here erases anything.
 */

/* Everything the report needs, read fresh each time the window opens. A question that fails leaves its section out. */
async function readFacts(configuration: Configuration): Promise<DayFacts | null> {
  const today = periodOf("today");
  const pack = configuration.pack;
  const value = async <T,>(asked: Promise<{ ok: true; value: T } | { ok: false }>): Promise<T | undefined> => {
    const answer = await asked;
    return answer.ok ? answer.value : undefined;
  };
  const [summary, top, cashNow, closings] = await Promise.all([
    value(machine.reportSummary(today)),
    value(machine.reportTop(today)),
    value(machine.cashCurrent()),
    value(machine.cashHistory()),
  ]);
  if (!summary) return null;
  const closedToday = (closings ?? []).find((session) => !session.otherDevice && session.closedAt !== null && session.closedAt >= today.from) ?? null;
  /*
   * Closing opens the next drawer at once. Until that one has taken anything,
   * the day's drawer is the one just closed, with its count, not the empty one.
   */
  const nextIsEmpty =
    cashNow && closedToday && closedToday.closedAt !== null && cashNow.openedAt >= closedToday.closedAt &&
    cashNow.cashSales === 0 && cashNow.cashPayments === 0 && cashNow.cashIn === 0 && cashNow.cashOut === 0;
  const facts: DayFacts = { summary, top: top ?? [], cash: nextIsEmpty ? closedToday : (cashNow ?? closedToday) };
  if (pack === "restaurant") facts.services = await value(machine.servicesBetween(today.from, today.to));
  if (pack === "hotel") facts.occupancy = await value(machine.occupancy(localDay(), localDay(1)));
  if (pack === "wash") facts.wash = await value(machine.washReport(today.from, today.to));
  if (pack === "transport") facts.routes = await value(machine.routeTakings(today.from, today.to));
  if (pack === "bakery") facts.baked = await value(machine.bakeryDay());
  if (pack === "warehouse") facts.flows = await value(machine.warehouseFlows(today.from, today.to));
  return facts;
}

export function EndOfDay({ configuration, t, tt, onClose }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; onClose: () => void }) {
  const [report, setReport] = useState<PrintedDay | null>(null);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void readFacts(configuration).then((facts) => {
      if (facts) setReport(dayReport(configuration, t, tt, facts));
      else setFailed(true);
    });
  }, [configuration, t, tt]);

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
        <div className="flex flex-wrap justify-end gap-2 max-md:grid max-md:grid-cols-2">
          <Button disabled={!report} onClick={print}>
            {tt.printIt}
          </Button>
          <Button disabled={!report} onClick={savePdf}>
            {tt.endDownloadPdf}
          </Button>
          <div className="max-md:col-span-2 max-md:grid">
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
        </div>
        </>
      }
    >
      {failed ? <Notice kind="problem" text={t.notSaved} /> : null}
      {report ? (
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
