import { useEffect, useState } from "react";
import { machine, type ActivationResult, type UiLanguage } from "./bridge";
import { copyFor, type Copy } from "./i18n";

/*
 * The one screen between a fresh install and his own shop, when the shop did
 * not open by itself.
 *
 * Nothing is typed here any more (Adel, 2026-11-17: no serial number for the
 * owner to copy or paste). A computer finds its shop through the download it
 * came from: opening his software's link on this computer, or pressing
 * Télécharger again on the website, marks this connection, and the screen,
 * which keeps asking, opens the shop the moment it is there. A phone opens
 * its shop from the link itself, so it is told to open the link.
 *
 * It speaks the language chosen on the first launch, and offers the other
 * two, one tap each.
 */

/* How often the screen asks whether the shop is there now, and for how long. Well under the website's limit of thirty tries in ten minutes. */
const ASK_EVERY_MS = 30_000; // not-a-rule: seconds between two questions to the website
const ASK_FOR_MS = 60 * 60_000; // not-a-rule: an hour of asking, then a button to ask again

/** The shop's number inside a link the owner copied: the phone app's (#serial=) or the website's (#ouvrir=). */
export function numberInLink(text: string): string | null {
  const found = /(?:serial|ouvrir)=([A-Za-z0-9-]{6,20})/.exec(text)?.[1];
  return found ? found.toUpperCase().replace(/-/g, "") : null;
}

export function messageFor(result: Extract<ActivationResult, { ok: false }>, copy: Copy): string {
  switch (result.error) {
    case "unknown_serial":
      return copy.errorUnknownSerial;
    case "device_limit":
      return copy.errorDeviceLimit;
    case "trial_not_available":
      return result.because === "no_fingerprint" ? copy.errorOldVersion : copy.errorTrialRefused;
    case "different_business":
      return copy.errorOtherShop;
    case "bad_token":
      return copy.errorLinkExpired;
    case "no_network":
      return copy.errorNoNetwork;
    case "already_active":
      return copy.errorAlreadyActive;
    case "slow_down":
      return copy.errorSlowDown;
    case "moved_too_often":
      return copy.errorMovedTooOften;
    default:
      return copy.errorGeneric;
  }
}

const OTHER_LANGUAGES: { value: UiLanguage; label: string }[] = [
  { value: "ar", label: "العربية" },
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
];

export function Activation({
  failure,
  language,
  phone,
  onLanguage,
  onDone,
}: {
  /* Set when the link from the website was tried and did not work. */
  failure: Extract<ActivationResult, { ok: false }> | null;
  language: UiLanguage;
  /* The app in a phone's browser: its shop comes from the link, never from a download. */
  phone: boolean;
  onLanguage: (language: UiLanguage) => void;
  onDone: () => void;
}) {
  const copy = copyFor(language);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<Extract<ActivationResult, { ok: false }> | null>(failure);
  /* A phone asks too: an iPhone's icon finds its shop from the link opened in Safari a moment ago. */
  const [asking, setAsking] = useState(true);

  /*
   * The link's answer arrives a few seconds after this screen has opened,
   * because activation is a network call. It is followed here, so the
   * sentence saying why always shows.
   */
  useEffect(() => {
    if (failure) setProblem(failure);
  }, [failure]);

  async function askNow(): Promise<boolean> {
    setWorking(true);
    const result = await machine.activateNearby();
    setWorking(false);
    if (result.ok) {
      onDone();
      return true;
    }
    /* Nothing found yet is not a problem to show: only a shop found and refused is. */
    if (!["no_nearby", "no_network", "already_active", "slow_down", "nearby_ambiguous"].includes(result.error)) setProblem(result);
    return false;
  }

  /*
   * The way in that needs nothing from the connection: the link copied in
   * Safari ("Copier le lien" on its page, or from WhatsApp), pasted here
   * with one tap. The phone asks to paste; the number inside the link is
   * never shown.
   */
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  async function paste() {
    setPasteNote(null);
    setProblem(null);
    let text = "";
    try {
      text = (await navigator.clipboard?.readText()) ?? "";
    } catch {
      text = "";
    }
    const serial = numberInLink(text);
    if (!serial) {
      setPasteNote(copy.activatePasteNone);
      return;
    }
    setWorking(true);
    const result = await machine.activate(serial);
    setWorking(false);
    if (result.ok) onDone();
    else setProblem(result);
  }

  /* On a computer, the screen keeps asking for a while, and when the window comes back to the front. */
  useEffect(() => {
    if (!asking) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > ASK_FOR_MS) {
        setAsking(false);
        return;
      }
      void askNow();
    }, ASK_EVERY_MS);
    const onFocus = () => void askNow();
    /* Coming back from Safari to the icon is a page made visible again, not a window focused. */
    const onVisible = () => {
      if (document.visibilityState === "visible") void askNow();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking]);

  const rtl = language === "ar";

  return (
    <div dir={rtl ? "rtl" : "ltr"} className="flex h-full items-center justify-center bg-background p-8 text-ink">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-end gap-2">
          {OTHER_LANGUAGES.filter((one) => one.value !== language).map((one) => (
            <button
              key={one.value}
              type="button"
              lang={one.value}
              onClick={() => onLanguage(one.value)}
              className="min-h-[48px] rounded-md border-2 border-line-strong px-4 text-base hover:bg-hover"
            >
              {one.label}
            </button>
          ))}
        </div>

        <h1 className="text-3xl font-semibold">{copy.activateTitle}</h1>
        <p className="mt-3 text-lg leading-relaxed text-ink-2">{phone ? copy.activateBodyPhone : copy.activateBody}</p>

        {problem ? (
          <div className="mt-6 rounded-lg border-2 border-ink p-4" role="alert">
            <p className="text-base leading-relaxed">{messageFor(problem, copy)}</p>
            {messageFor(problem, copy) === copy.errorGeneric ? (
              <p className="mt-2 text-base text-ink-3" dir="ltr">
                Code : {problem.error}
              </p>
            ) : null}
            {problem.supportWhatsapp ? (
              <button
                type="button"
                onClick={() => void machine.openWhatsapp(problem.supportWhatsapp ?? "")}
                className="mt-3 min-h-[48px] rounded-md border-2 border-ink px-4 text-base font-medium"
              >
                {copy.whatsapp}
              </button>
            ) : null}
          </div>
        ) : null}

        {phone ? (
          <>
            <p className="mt-6 text-base text-ink-2" role="status">
              {copy.activateWaiting}
            </p>
            <button
              type="button"
              disabled={working}
              onClick={() => void paste()}
              className="mt-6 min-h-[56px] w-full rounded-lg bg-ink text-lg font-semibold text-on-ink disabled:opacity-30"
            >
              {working ? copy.activating : copy.activatePaste}
            </button>
            <p className="mt-3 text-base leading-relaxed text-ink-2">{pasteNote ?? copy.activatePasteHelp}</p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void machine.openSite(language)}
              className="mt-8 min-h-[56px] w-full rounded-lg bg-ink text-lg font-semibold text-on-ink"
            >
              {copy.activateOpenSite}
            </button>
            <p className="mt-4 flex items-center gap-2 text-base text-ink-2" role="status">
              {working || asking ? copy.activateWaiting : null}
            </p>
            {asking ? null : (
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  setProblem(null);
                  void askNow().then((opened) => {
                    if (!opened) setAsking(true);
                  });
                }}
                className="mt-2 min-h-[48px] w-full rounded-lg border-2 border-line-strong text-base font-medium hover:bg-hover disabled:opacity-30"
              >
                {working ? copy.activating : copy.activateRetry}
              </button>
            )}
          </>
        )}

        <p className="mt-4 text-base leading-relaxed text-ink-3">{copy.activateNeedsInternet}</p>
      </div>
    </div>
  );
}
