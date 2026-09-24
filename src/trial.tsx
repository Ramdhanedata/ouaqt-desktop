import { useEffect, useState } from "react";
import { machine, type UiLanguage } from "./bridge";
import { daysLeftLine, type Copy } from "./i18n";
import { icons } from "./icons";

/*
 * How the trial is spoken of, now that it no longer sits at the top of every
 * screen. The countdown made the software feel borrowed, but an owner who
 * hears nothing until day 31 is surprised by a till he can no longer use. So:
 *
 *   every day     Settings says where the trial stands, in one plain line;
 *   last 5 days   a notice, once a day, that closes for the rest of the day;
 *   at the end    a screen that says it has ended and how to go on, with his
 *                 serial number in front of him, then his data, read-only.
 *
 * Nothing here ever stops him reading or exporting what he has recorded.
 */

export const REMINDER_DAYS = 5; // not-a-rule: the brief's own five days

const CLOSED_KEY = "ouaqt.trialReminderClosed";

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

export function TrialReminder({ copy, language, daysLeft }: { copy: Copy; language: UiLanguage; daysLeft: number }) {
  const [closed, setClosed] = useState(closedToday);
  if (closed) return null;

  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-warning-soft px-4 py-2 text-base text-ink">
      <icons.warning className="shrink-0 text-warning" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{daysLeftLine(copy, language, daysLeft)}</span> {copy.trialReminderHow}
      </span>
      <button
        type="button"
        onClick={() => void machine.openPayment(language)}
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
  trial,
  onSeeData,
}: {
  copy: Copy;
  language: UiLanguage;
  /* The trial ended, rather than a paid licence. */
  trial: boolean;
  onSeeData: () => void;
}) {
  const [serial, setSerial] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void machine.licenceSerial().then(setSerial);
  }, []);

  return (
    <div className="flex h-full items-center justify-center bg-background p-8">
      <div className="w-full max-w-lg rounded-xl border-2 border-line bg-surface p-8">
        <h1 className="text-3xl font-semibold">{trial ? copy.trialEndedTitle : copy.licenceEndedTitle}</h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-2">{copy.endedBody}</p>

        {serial ? (
          <div className="mt-6 rounded-lg border-2 border-line-strong p-4">
            <div className="text-base text-ink-2">{copy.yourSerial}</div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <bdi dir="ltr" className="text-3xl font-semibold tracking-widest">
                {serial}
              </bdi>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(serial).then(() => setCopied(true))}
                className="flex min-h-[44px] items-center gap-2 rounded-lg border-2 border-line-strong px-4 text-base hover:bg-hover"
              >
                <icons.copy size={18} />
                {copied ? copy.copiedSerial : copy.copySerial}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void machine.openPayment(language)}
            className="min-h-[56px] flex-1 rounded-lg bg-ink px-6 text-lg font-semibold text-on-ink active:bg-ink/80"
          >
            {copy.payOnSite}
          </button>
          <button
            type="button"
            onClick={onSeeData}
            className="min-h-[56px] rounded-lg border-2 border-line-strong px-6 text-lg hover:bg-hover"
          >
            {copy.seeData}
          </button>
        </div>
      </div>
    </div>
  );
}
