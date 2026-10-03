import { useCallback, useEffect, useRef, useState } from "react";
import { machine, type LicenceState, type PayHelp, type UiLanguage } from "./bridge";
import { type Copy } from "./i18n";
import { fill } from "./i18n/screens";
import { icons } from "./icons";
import payExample from "./pay-example.webp";
import { qrCode, qrPath } from "./qr";
import { day, money } from "./ui";

/*
 * How the licence is spoken of.
 *
 *   the trial     counts down out of sight: Settings says where it stands,
 *                 for an owner who looks, and nothing else interrupts him
 *                 (Adel's decision, 2026-09-25);
 *   at its end    the software stops selling, and a kind window says so the
 *                 minute it ends, each time the app opens and at each sale
 *                 refused after it, with how to pay step by step (his payment
 *                 app, our number, the amount, his serial copied into the
 *                 payment's note, then the screenshot sent from his phone or
 *                 from here), an example of that app's screen filled in, and
 *                 a WhatsApp button to OUAQT (Adel, 2026-10-03). While it is
 *                 open it asks the website whether he has paid, so a payment
 *                 that is confirmed opens the software by itself;
 *   a paid year   is reminded of once a day in its last five days and
 *                 through the grace days after it, when it still works.
 *
 * Nothing here ever stops him reading or exporting what he has recorded.
 */

export const REMINDER_DAYS = 5; // not-a-rule: the brief's own five days
const CHECK_EVERY_S = 15; // not-a-rule: how often the ended window asks whether he has paid
const PAYING_CHECK_S = 10; // not-a-rule: how often once he has opened the payment page
const PAID_SHOWN_S = 6; // not-a-rule: long enough to read what the payment bought
const MS_IN_A_DAY = 86_400_000;

const CLOSED_KEY = "ouaqt.licenceReminderClosed";

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function closedToday(): boolean {
  try {
    return window.localStorage.getItem(CLOSED_KEY) === today();
  } catch {
    return false;
  }
}

type OkLicence = Extract<LicenceState, { kind: "ok" }>;

/** Whether a paid licence is near its end, or past it and still working: the daily reminder. */
export function remindsToRenew(licence: OkLicence): boolean {
  if (licence.plan === "trial") return false;
  if (licence.status === "renewal_due") return true;
  return licence.status === "active" && licence.daysLeft !== null && licence.daysLeft <= REMINDER_DAYS;
}

export function LicenceReminder({ copy, language, licence }: { copy: Copy; language: UiLanguage; licence: OkLicence }) {
  const [closed, setClosed] = useState(closedToday);
  if (closed || !licence.endsAt) return null;

  const ends = day(licence.endsAt.slice(0, 10), language);
  const line =
    licence.status === "renewal_due" && licence.graceUntil
      ? fill(copy.licenceInGrace, { date: ends, until: day(licence.graceUntil.slice(0, 10), language) })
      : fill(copy.licenceEndsOn, { date: ends });

  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-warning-soft px-4 py-2 text-base text-ink">
      <icons.warning className="shrink-0 text-warning" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{line}</span> {copy.renewHow}
      </span>
      <button
        type="button"
        onClick={() => void machine.openPayment(language, true)}
        className="min-h-[44px] rounded-lg bg-ink px-4 font-medium text-on-ink active:bg-ink/80"
      >
        {copy.payOnSite}
      </button>
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.setItem(CLOSED_KEY, today());
          } catch {
            // Without storage it closes for this sitting only.
          }
          setClosed(true);
        }}
        className="min-h-[44px] rounded-lg px-4 text-ink-2 hover:bg-hover"
      >
        {copy.dismissToday}
      </button>
    </div>
  );
}

export function LicenceEnded({
  copy,
  language,
  licence,
  onSeeData,
  onPaid,
}: {
  copy: Copy;
  language: UiLanguage;
  licence: OkLicence;
  onSeeData: () => void;
  /* A payment was confirmed and the licence works again. */
  onPaid: () => void;
}) {
  const trial = licence.status === "expired_trial";
  const [serial, setSerial] = useState<string | null>(null);
  const [help, setHelp] = useState<PayHelp | null>(null);
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState<"idle" | "checking" | "not_yet" | "offline">("idle");
  const [paying, setPaying] = useState(false);
  const [saved, setSaved] = useState<"saved" | "failed" | null>(null);
  /* A payment confirmed: what it bought, shown before the software opens again. */
  const [paid, setPaid] = useState<{ length: PaidLength; endsAt: string | null } | null>(null);
  const busy = useRef(false);
  const opened = useRef(false);

  useEffect(() => {
    void machine.licenceSerial().then(setSerial);
    void machine.payHelp(language).then(setHelp);
  }, [language]);

  /* Once, whether by the button or by the wait running out. */
  const reopen = useCallback(() => {
    if (opened.current) return;
    opened.current = true;
    onPaid();
  }, [onPaid]);

  /* The licence as it was when it ended: what a payment is measured from. */
  const endedWith = useRef(licence);

  /* Paid: what it bought, said for a few seconds, and then the software is his again. */
  const confirmed = useCallback(
    (now: OkLicence) => {
      if (opened.current) return;
      setPaid((shown) => shown ?? { length: lengthPaid(endedWith.current, now), endsAt: now.endsAt });
      setTimeout(reopen, PAID_SHOWN_S * 1000);
    },
    [reopen]
  );

  /* Asked by the button, or by itself: has a payment been confirmed? */
  const ask = useCallback(
    async (pressed: boolean) => {
      if (busy.current || opened.current) return;
      busy.current = true;
      if (pressed) setCheck("checking");
      try {
        const answer = await machine.checkLicence();
        if (answer.state.kind === "ok" && answer.state.canSell) confirmed(answer.state);
        else if (pressed || !answer.reached) setCheck(answer.reached ? "not_yet" : "offline");
      } finally {
        busy.current = false;
      }
    },
    [confirmed]
  );

  /* Noticed by the window's own reading of the licence first, it is said all the same. */
  useEffect(() => {
    if (licence.canSell) confirmed(licence);
  }, [licence, confirmed]);

  /* Every quarter minute, and every ten seconds once he has opened the page here. */
  const every = paying ? PAYING_CHECK_S : CHECK_EVERY_S;
  useEffect(() => {
    const timer = setInterval(() => void ask(false), every * 1000);
    return () => clearInterval(timer);
  }, [ask, every]);

  const days =
    licence.startsAt && licence.endsAt
      ? Math.round((Date.parse(licence.endsAt) - Date.parse(licence.startsAt)) / MS_IN_A_DAY)
      : null;
  const body = trial && days ? fill(copy.trialEndedBody, { days }) : copy.licenceEndedBody;
  const status =
    check === "checking"
      ? copy.checking
      : check === "not_yet"
        ? fill(copy.notYet, { seconds: every })
        : check === "offline"
          ? copy.offline
          : null;

  /*
   * Paid: said plainly, with what it bought and until when, for a few
   * seconds, and then the software is his again. He can open it at once.
   */
  if (paid) {
    return (
      <div className="flex h-full overflow-y-auto bg-background p-6">
        <div role="status" className="m-auto w-full max-w-xl rounded-xl border-2 border-success bg-surface p-8 text-center">
          <icons.check size={56} className="mx-auto text-success" />
          <h1 className="mt-4 text-3xl font-semibold">
            {paid.length === "year" ? copy.paidYear : paid.length === "six" ? copy.paidSixMonths : copy.paidTitle}
          </h1>
          {paid.endsAt ? (
            <p className="mt-3 text-lg text-ink-2">{fill(copy.paidUntil, { date: day(paid.endsAt.slice(0, 10), language) })}</p>
          ) : null}
          <p className="mt-2 text-base text-ink-2">{copy.paidOpening}</p>
          <button
            type="button"
            onClick={reopen}
            className="mt-6 min-h-[56px] w-full rounded-lg bg-ink px-6 text-lg font-semibold text-on-ink active:bg-ink/80"
          >
            {copy.openNow}
          </button>
        </div>
      </div>
    );
  }

  const code = help?.payLink ? qrPath(qrCode(help.payLink)) : null;

  /*
   * Where the money goes and how much, as the website last sent them. One
   * number for every app is the usual case; apps with numbers of their own
   * are listed each with its own.
   */
  const payTo = help?.payTo ?? [];
  const apps = payTo.map((one) => (language === "ar" ? one.nameArabic : one.name)).filter(Boolean);
  const numbers = [...new Set(payTo.map((one) => one.number))];
  const plans = (help?.prices ?? []).flatMap((one) => {
    const plan = one.plan === "annual" ? copy.planYear : one.plan === "semiannual" ? copy.planSixMonths : null;
    return plan ? [fill(copy.planPrice, { plan, amount: money(one.amount, language) })] : [];
  });

  return (
    /* m-auto rather than centring: a card taller than the window scrolls from its top instead of losing it. */
    <div className="flex h-full overflow-y-auto bg-background p-6">
      <div className="m-auto w-full max-w-6xl rounded-xl border-2 border-line bg-surface p-8">
        <h1 className="text-3xl font-semibold">{trial ? copy.trialEndedTitle : copy.licenceEndedTitle}</h1>
        <p className="mt-3 text-base leading-relaxed text-ink-2">{body}</p>

        {/*
          * How to pay, in the order he does it: in his payment app on his
          * phone, to our number, with his serial in the note so the payment
          * is his at a glance; then the screenshot, sent from the phone or
          * from here. Beside it, what that app's screen looks like filled in.
          */}
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem_minmax(0,1fr)]">
          <section>
            <h2 className="text-lg font-semibold">{copy.howToPay}</h2>
            <ol className="mt-3 space-y-4">
              <PayStep n={1}>{apps.length > 0 ? fill(copy.payStepApp, { apps: anyOf(apps, language) }) : copy.payStepAppAny}</PayStep>
              <PayStep n={2}>
                {numbers.length > 1 ? (
                  <>
                    {copy.payStepSendEach}
                    <ul className="mt-1 space-y-1">
                      {payTo.map((one) => (
                        <li key={one.app}>
                          {language === "ar" ? one.nameArabic : one.name}{" "}
                          <bdi dir="ltr" className="font-semibold">
                            {one.number}
                          </bdi>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  around(copy.payStepSend, "{number}", <bdi dir="ltr" className="text-lg font-semibold">{numbers[0] ?? ""}</bdi>)
                )}
                {plans.length > 0 ? <p className="mt-1 text-ink-2">{fill(copy.payAmount, { amounts: plans.join(" · ") })}</p> : null}
              </PayStep>
              <PayStep n={3}>
                {copy.payStepNote}
                {serial ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-line-strong px-4 py-2">
                    <div>
                      <div className="text-base text-ink-2">{copy.yourSerial}</div>
                      <bdi dir="ltr" className="text-2xl font-semibold tracking-widest">
                        {serial}
                      </bdi>
                    </div>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(serial).then(() => setCopied(true))}
                      className="flex min-h-[44px] items-center gap-2 rounded-lg border-2 border-line-strong px-4 text-base hover:bg-hover"
                    >
                      <icons.copy size={18} />
                      {copied ? copy.copiedSerial : copy.copySerial}
                    </button>
                  </div>
                ) : null}
              </PayStep>
            </ol>
          </section>

          <figure className="mx-auto w-60">
            {/* The app's own screen, right to left as it is on his phone, with what goes where written in. */}
            <div className="relative overflow-hidden rounded-lg border-2 border-line-strong bg-white" dir="ltr">
              <img src={payExample} alt={copy.exampleAlt} className="block w-full" />
              {numbers[0] ? <Filled top="41.4%" text={numbers[0]} /> : null}
              {serial ? <Filled top="81.7%" text={serial} /> : null}
            </div>
            <figcaption className="mt-2 text-center text-base text-ink-2">{copy.exampleCaption}</figcaption>
          </figure>

          <section>
            <ol start={4}>
              <PayStep n={4}>{copy.payStepScreenshot}</PayStep>
            </ol>
            {/*
              * The screenshot goes up from his phone, where it is: the code
              * opens a page already on his shop that asks for it, and the
              * amount on it says a year or six months. From here only when
              * the screenshot happens to be on this computer.
              */}
            <div className="mt-3 flex items-center gap-4 rounded-lg border-2 border-line-strong p-3">
              {code ? (
                <svg
                  viewBox={`0 0 ${code.box} ${code.box}`}
                  className="h-32 w-32 shrink-0 rounded bg-white"
                  shapeRendering="crispEdges"
                  role="img"
                  aria-label={copy.scanAlt}
                  data-pay-link
                >
                  <rect width={code.box} height={code.box} fill="#fff" />
                  <path d={code.path} fill="#000" />
                </svg>
              ) : null}
              <p className="text-base leading-snug">{copy.scanHow}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setPaying(true);
                void machine.openPayment(language, true);
              }}
              className="mt-3 min-h-[48px] w-full rounded-lg border-2 border-line-strong px-4 text-base hover:bg-hover"
            >
              {copy.payNow}
            </button>
          </section>
        </div>
        <p className="mt-5 text-base font-semibold">{copy.reopens}</p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void ask(true)}
            disabled={check === "checking"}
            className="min-h-[56px] flex-1 whitespace-nowrap rounded-lg border-2 border-line-strong px-6 text-lg font-semibold hover:bg-hover disabled:opacity-60"
          >
            {copy.checkNow}
          </button>
          {help?.supportWhatsapp ? (
            <button
              type="button"
              onClick={() => void machine.openWhatsapp(help.supportWhatsapp ?? "")}
              className="min-h-[56px] flex-1 whitespace-nowrap rounded-lg border-2 border-line-strong px-6 text-lg hover:bg-hover"
            >
              {copy.contactOuaqt}
            </button>
          ) : null}
          {/*
            * At the end of the trial the software stops here until it is paid.
            * What he recorded is still his: he can take a copy of it with him.
            * A paid licence that lapsed still opens his data to read.
            */}
          {trial ? (
            <button
              type="button"
              onClick={() => void machine.backupSave().then((answer) => setSaved(answer.ok && answer.value ? "saved" : answer.ok ? null : "failed"))}
              className="min-h-[44px] text-base text-ink-2 underline underline-offset-4"
            >
              {copy.saveData}
            </button>
          ) : (
            <button type="button" onClick={onSeeData} className="min-h-[44px] text-base text-ink-2 underline underline-offset-4">
              {copy.seeData}
            </button>
          )}
        </div>
        {status ? (
          <p role="status" className="mt-3 text-base leading-relaxed text-ink-2">
            {status}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="mt-3 text-base text-ink-2">
            {saved === "saved" ? copy.savedData : copy.saveDataFailed}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* What a confirmed payment bought, as the owner says it: a year, six months, or not to be told apart. */
type PaidLength = "year" | "six" | null;

/*
 * Told from the licence before and after. The time bought starts from
 * today, or from the end he still had when he paid early (as the website
 * grants it), so the new end, less that start, is about six months or about
 * a year. Anything else (a gift, a change by hand) is not named.
 */
function lengthPaid(before: OkLicence, after: OkLicence): PaidLength {
  if (!after.endsAt) return null;
  const from = Math.max(Date.now(), before.endsAt ? Date.parse(before.endsAt) : 0);
  const days = (Date.parse(after.endsAt) - from) / MS_IN_A_DAY;
  if (days > 170 && days < 195) return "six"; // not-a-rule: six months, with room for a late check
  if (days > 350 && days < 380) return "year"; // not-a-rule: a year, with the same room
  return null;
}

/* One step of paying: its number in a ring, then what to do. */
function PayStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-line-strong text-base font-semibold">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5 text-base leading-snug">{children}</div>
    </li>
  );
}

/* What he types, written into the example's field at its height, from the right as the app writes it. */
function Filled({ top, text }: { top: string; text: string }) {
  return (
    <span
      className="absolute -translate-y-1/2 rounded bg-warning-soft px-1.5 text-base font-semibold leading-tight text-ink ring-2 ring-warning"
      style={{ top, right: "8%" }}
    >
      <bdi dir="ltr">{text}</bdi>
    </span>
  );
}

/* A sentence with one part that is not words, such as a number set in bold: the sentence around it, it in its place. */
function around(sentence: string, slot: string, part: React.ReactNode): React.ReactNode {
  const at = sentence.indexOf(slot);
  if (at < 0) return sentence;
  return (
    <>
      {sentence.slice(0, at)}
      {part}
      {sentence.slice(at + slot.length)}
    </>
  );
}

/* "Bankily, Masrvi or Click", the way each language says it. */
function anyOf(names: string[], language: UiLanguage): string {
  return new Intl.ListFormat(language, { type: "disjunction" }).format(names);
}
