import { useCallback, useEffect, useRef, useState } from "react";
import { machine, type LicenceState, type PayHelp, type ScreenshotAnswer, type UiLanguage } from "./bridge";
import { type Copy } from "./i18n";
import { fill } from "./i18n/screens";
import { icons } from "./icons";
import { lengthName, monthsPaid, pricedLengths, type Months } from "./licence-lengths";
import { qrCode, qrPath } from "./qr";
import { screenshotJpeg } from "./screenshot";
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
 *                 a WhatsApp button to OUAQT (Adel, 2026-10-03). Every length
 *                 he may pay for is listed with its price, a month to a year
 *                 (2026-11-06): the amount he sends is what says which. While
 *                 it is open it asks the website whether he has paid, and at
 *                 once when he comes back to it, so a payment that is
 *                 confirmed opens the software by itself. On a phone there is
 *                 no code to scan: the screenshot is sent from the phone itself;
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
  phone = false,
  onSeeData,
  onPaid,
}: {
  copy: Copy;
  language: UiLanguage;
  licence: OkLicence;
  /* Running on a phone: the screenshot is already on it, so it is sent from here rather than scanned for. */
  phone?: boolean;
  onSeeData: () => void;
  /* A payment was confirmed and the licence works again. */
  onPaid: () => void;
}) {
  const trial = licence.status === "expired_trial";
  const [serial, setSerial] = useState<string | null>(null);
  const [help, setHelp] = useState<PayHelp | null>(null);
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState<"idle" | "checking" | "not_yet" | "offline">("idle");
  const [paying] = useState(false);
  /* The screenshot sent from here, and what the website answered. */
  const [shot, setShot] = useState<ScreenshotAnswer | "sending" | null>(null);
  const [saved, setSaved] = useState<"saved" | "failed" | null>(null);
  /* A payment confirmed: what it bought, shown before the software opens again. */
  const [paid, setPaid] = useState<{ months: Months | null; endsAt: string | null } | null>(null);
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
      setPaid((shown) => shown ?? { months: monthsPaid(endedWith.current, now), endsAt: now.endsAt });
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

  /*
   * Back from paying (the payment app, the page that took the screenshot),
   * it asks at once rather than at the next tick: a phone holds a page's
   * timers while another app is in front, and he should not wait to see it.
   */
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === "visible") void ask(false);
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [ask]);

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
      <div className="flex h-full overflow-y-auto bg-background p-3 sm:p-6">
        <div role="status" className="m-auto w-full max-w-xl rounded-xl border-2 border-success bg-surface p-5 text-center sm:p-8">
          <icons.check size={56} className="mx-auto text-success" />
          <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">
            {paid.months ? fill(copy.paidFor, { plan: lengthName(copy, paid.months) }) : copy.paidTitle}
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
  const lengths = pricedLengths(help?.prices ?? []);

  /* The screenshot sent from here: chosen, made small, read by the website. */
  const sendShot = async (file: File | undefined) => {
    if (!file || shot === "sending") return;
    setShot("sending");
    const jpeg = await screenshotJpeg(file);
    if (!jpeg) {
      setShot({ kind: "problem", reason: "bad_image" });
      return;
    }
    const answer = await machine.sendScreenshot(jpeg);
    setShot(answer);
    /* Confirmed: the licence was read again over there, so asking now finds it open. */
    if (answer.kind === "confirmed") void ask(false);
  };
  const smallest = lengths.length > 0 ? Math.min(...lengths.map((one) => one.amount)) : null;
  const why = (codes: string[]) => {
    const one = codes[0] ?? "";
    if (one === "wrong_recipient") return fill(copy.whyRecipient, { number: numbers[0] ?? "" });
    if (one === "amount_too_low" || one === "wrong_amount") return fill(copy.whyAmount, { amount: smallest === null ? "" : money(smallest, language) });
    if (one === "wrong_date") return copy.whyDate;
    if (one === "not_receipt") return copy.whyNotReceipt;
    if (one === "image_used" || one === "reference_used") return copy.whyUsed;
    return copy.whyUnread;
  };
  const shotLine =
    shot === null || shot === "sending" || shot.kind === "confirmed"
      ? null
      : shot.kind === "waiting"
        ? { text: copy.shotWaiting, kind: "info" as const }
        : shot.kind === "refused"
          ? { text: fill(copy.shotRefused, { why: why(shot.codes) }), kind: "problem" as const }
          : {
              text:
                shot.reason === "offline"
                  ? copy.shotOffline
                  : shot.reason === "bad_image"
                    ? copy.shotBadImage
                    : shot.reason === "slow_down"
                      ? copy.shotSlowDown
                      : copy.shotFailed,
              kind: "problem" as const,
            };
  const whatsapp = help?.supportWhatsapp ?? null;

  return (
    /* m-auto rather than centring: a card taller than the window scrolls from its top instead of losing it. */
    <div className="flex h-full overflow-y-auto bg-background p-3 sm:p-6">
      <div className="m-auto w-full max-w-3xl rounded-xl border-2 border-line bg-surface p-5 sm:p-8">
        <h1 className="text-2xl font-semibold sm:text-3xl">{trial ? copy.trialEndedTitle : copy.licenceEndedTitle}</h1>
        <p className="mt-2 text-lg leading-relaxed text-ink-2">{copy.easyBody}</p>

        {/*
          * Two steps and nothing else (Adel, 2026-11-13: "a 5 year old can do
          * it"): send the money from any payment app, then send the
          * screenshot, from here or on WhatsApp. The app sends its own serial,
          * so nothing is written in the payment's note.
          */}
        <ol className="mt-6 space-y-5">
          <li className="rounded-xl border-2 border-line-strong p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <StepRing n={1} />
              <h2 className="text-xl font-semibold">{copy.easyStepSend}</h2>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <bdi dir="ltr" className="text-4xl font-bold tracking-wider" data-pay-number>
                {numbers[0] ?? ""}
              </bdi>
              {numbers[0] ? (
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(numbers[0] ?? "").then(() => setCopied(true))}
                  className="flex min-h-[48px] items-center gap-2 rounded-lg border-2 border-line-strong px-4 text-base hover:bg-hover"
                >
                  <icons.copy size={18} />
                  {copied ? copy.copiedSerial : copy.copySerial}
                </button>
              ) : null}
            </div>
            {apps.length > 0 ? <p className="mt-1 text-lg text-ink-2">{fill(copy.easyWith, { apps: anyOf(apps, language) })}</p> : null}
            {lengths.length > 0 ? (
              <>
                <p className="mt-4 text-base text-ink-2">{copy.easyAmounts}</p>
                <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5" data-pay-lengths>
                  {lengths.map((one) => (
                    <li key={one.months} className="rounded-lg border-2 border-line px-3 py-2 text-center">
                      <div className="text-base">{lengthName(copy, one.months)}</div>
                      <div className="text-lg font-semibold tabular-nums">{money(one.amount, language)}</div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </li>

          <li className="rounded-xl border-2 border-line-strong p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <StepRing n={2} />
              <h2 className="text-xl font-semibold">{copy.easyStepShot}</h2>
            </div>
            <label
              className={`mt-4 flex min-h-[64px] w-full cursor-pointer items-center justify-center gap-3 rounded-lg bg-ink px-6 text-xl font-semibold text-on-ink active:bg-ink/80 ${shot === "sending" ? "pointer-events-none opacity-60" : ""}`}
              data-send-screenshot
            >
              <icons.inbox size={26} />
              {shot === "sending" ? copy.sendingShot : phone ? copy.chooseShotPhone : copy.chooseShot}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={shot === "sending"}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void sendShot(file);
                }}
              />
            </label>
            {shotLine ? (
              <p
                role={shotLine.kind === "problem" ? "alert" : "status"}
                className={`mt-3 rounded-lg p-3 text-base leading-relaxed ${shotLine.kind === "problem" ? "border-2 border-danger bg-danger-soft" : "bg-hover"}`}
              >
                {shotLine.text}
              </p>
            ) : null}
            {whatsapp ? (
              <>
                <p className="my-3 text-center text-base text-ink-2">{copy.or}</p>
                <button
                  type="button"
                  onClick={() => void machine.openWhatsapp(whatsapp, fill(copy.whatsappMessage, { serial: serial ?? "" }))}
                  className="flex min-h-[64px] w-full items-center justify-center gap-3 rounded-lg bg-[#25D366] px-6 text-xl font-semibold text-white active:opacity-80"
                  data-whatsapp
                >
                  {copy.whatsappShot}
                </button>
                <p className="mt-2 text-center text-base text-ink-2">{copy.whatsappShotHint}</p>
              </>
            ) : null}
            {/* On a computer the screenshot is usually on the phone: the code opens the payment page there, on this shop. */}
            {!phone && code ? (
              <div className="mt-4 flex items-center gap-4 border-t border-line pt-4">
                <svg
                  viewBox={`0 0 ${code.box} ${code.box}`}
                  className="h-24 w-24 shrink-0 rounded bg-white"
                  shapeRendering="crispEdges"
                  role="img"
                  aria-label={copy.scanAlt}
                  data-pay-link
                >
                  <rect width={code.box} height={code.box} fill="#fff" />
                  <path d={code.path} fill="#000" />
                </svg>
                <p className="text-base leading-snug text-ink-2">{copy.scanSmall}</p>
              </div>
            ) : null}
          </li>
        </ol>

        <p className="mt-5 text-base font-semibold">{copy.reopens}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={() => void ask(true)}
            disabled={check === "checking"}
            className="min-h-[48px] rounded-lg border-2 border-line-strong px-5 text-base font-semibold hover:bg-hover disabled:opacity-60"
          >
            {copy.checkNow}
          </button>
          {/*
            * What he recorded is still his, as the terms of use promise for a
            * trial and for a lapsed licence alike (2026-10-02): he can read
            * it, the software in read-only, and at the end of a trial take a
            * copy of it with him.
            */}
          <button type="button" onClick={onSeeData} className="min-h-[44px] text-base text-ink-2 underline underline-offset-4" data-see-data>
            {copy.seeData}
          </button>
          {trial ? (
            <button
              type="button"
              onClick={() => void machine.backupSave().then((answer) => setSaved(answer.ok && answer.value ? "saved" : answer.ok ? null : "failed"))}
              className="min-h-[44px] text-base text-ink-2 underline underline-offset-4"
            >
              {copy.saveData}
            </button>
          ) : null}
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

/* A step's number in a ring. */
function StepRing({ n }: { n: number }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-lg font-semibold text-on-ink">{n}</span>
  );
}




/* "Bankily, Masrvi or Click", the way each language says it. */
function anyOf(names: string[], language: UiLanguage): string {
  return new Intl.ListFormat(language, { type: "disjunction" }).format(names);
}
