import { useCallback, useEffect, useRef, useState } from "react";
import { machine, type LicenceState, type PayHelp, type UiLanguage } from "./bridge";
import { type Copy } from "./i18n";
import { fill } from "./i18n/screens";
import { icons } from "./icons";
import { day } from "./ui";

/*
 * How the licence is spoken of.
 *
 *   the trial     counts down out of sight: Settings says where it stands,
 *                 for an owner who looks, and nothing else interrupts him
 *                 (Adel's decision, 2026-09-25);
 *   at its end    the software stops selling, and each time it opens a kind
 *                 window says so, with his serial number, a button to the
 *                 payment page with that number already in it, the address
 *                 for his phone and a WhatsApp button to OUAQT. While it is
 *                 open it asks the website whether he has paid, so a payment
 *                 that is confirmed opens the software by itself;
 *   a paid year   is reminded of once a day in its last five days and
 *                 through the grace days after it, when it still works.
 *
 * Nothing here ever stops him reading or exporting what he has recorded.
 */

export const REMINDER_DAYS = 5; // not-a-rule: the brief's own five days
const CHECK_EVERY_S = 30; // not-a-rule: how often the ended window asks whether he has paid
const PAYING_CHECK_S = 10; // not-a-rule: how often once he has opened the payment page
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
  const [check, setCheck] = useState<"idle" | "checking" | "not_yet" | "offline" | "paid">("idle");
  const [paying, setPaying] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    void machine.licenceSerial().then(setSerial);
    void machine.payHelp(language).then(setHelp);
  }, [language]);

  /* Asked by the button, or by itself: has a payment been confirmed? */
  const ask = useCallback(
    async (pressed: boolean) => {
      if (busy.current) return;
      busy.current = true;
      if (pressed) setCheck("checking");
      try {
        const answer = await machine.checkLicence();
        if (answer.state.kind === "ok" && answer.state.canSell) {
          setCheck("paid");
          setTimeout(onPaid, 1500); // not-a-rule: long enough to read "confirmed"
        } else if (pressed || !answer.reached) {
          setCheck(answer.reached ? "not_yet" : "offline");
        }
      } finally {
        busy.current = false;
      }
    },
    [onPaid]
  );

  /* Every half minute, and every ten seconds once he has gone to pay. */
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
          : check === "paid"
            ? copy.paidOpening
            : null;

  /* The address stays left to right inside an Arabic sentence. */
  const [beforeAddress, afterAddress] = copy.orPhone.split("{address}");

  return (
    /* m-auto rather than centring: a card taller than the window scrolls from its top instead of losing it. */
    <div className="flex h-full overflow-y-auto bg-background p-6">
      <div className="m-auto w-full max-w-2xl rounded-xl border-2 border-line bg-surface p-8">
        <h1 className="text-3xl font-semibold">{trial ? copy.trialEndedTitle : copy.licenceEndedTitle}</h1>
        <p className="mt-3 text-base leading-relaxed text-ink-2">{body}</p>

        {serial ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-line-strong px-4 py-3">
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

        {/* The way that asks least of him: the page opens with his serial, he adds the screenshot. */}
        <button
          type="button"
          onClick={() => {
            setPaying(true);
            void machine.openPayment(language, true);
          }}
          className="mt-5 min-h-[56px] w-full rounded-lg bg-ink px-6 text-lg font-semibold text-on-ink active:bg-ink/80"
        >
          {copy.payNow}
        </button>
        <p className="mt-2 text-base leading-relaxed text-ink-2">{copy.payNowHow}</p>
        {help ? (
          <p className="mt-3 text-base leading-relaxed text-ink-2">
            {beforeAddress}
            <bdi dir="ltr" className="font-semibold text-ink">
              {help.payAddress}
            </bdi>
            {afterAddress}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void ask(true)}
            disabled={check === "checking" || check === "paid"}
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
        </div>
        {status ? (
          <p role="status" className="mt-4 text-base leading-relaxed text-ink-2">
            {status}
          </p>
        ) : null}

        <div className="mt-3">
          <button type="button" onClick={onSeeData} className="min-h-[44px] text-base text-ink-2 underline underline-offset-4">
            {copy.seeData}
          </button>
        </div>
      </div>
    </div>
  );
}
