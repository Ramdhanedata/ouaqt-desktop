import { useEffect, useState } from "react";
import { machine, type ActivationResult, type UiLanguage } from "./bridge";
import { copyFor, type Copy } from "./i18n";

/*
 * The one screen between a fresh install and his own shop.
 *
 * Reached by the owner who built his software on a phone, and by anyone whose
 * link from the website did not work. It asks for one thing, says in one
 * plain sentence what went wrong when something does, and always leaves a
 * way forward: nobody is stuck here.
 *
 * It speaks the language chosen on the first launch. There is no Settings
 * yet on this screen, so the other two languages are offered here too, one
 * tap each, and choosing one changes the same setting Settings will show.
 */

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
  onLanguage,
  onDone,
}: {
  /* Set when the link from the website was tried and did not work. */
  failure: Extract<ActivationResult, { ok: false }> | null;
  language: UiLanguage;
  onLanguage: (language: UiLanguage) => void;
  onDone: () => void;
}) {
  const copy = copyFor(language);
  const [serial, setSerial] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<Extract<ActivationResult, { ok: false }> | null>(failure);

  /*
   * The link's answer arrives a few seconds after this screen has opened,
   * because activation is a network call. Taking the failure only at first
   * render meant the sentence never showed, and the owner who clicked the
   * link was left on a blank form with no idea why. It is followed here.
   */
  useEffect(() => {
    if (failure) setProblem(failure);
  }, [failure]);

  async function submit() {
    setWorking(true);
    setProblem(null);
    const result = await machine.activate(serial);
    setWorking(false);
    if (result.ok) onDone();
    else setProblem(result);
  }

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
        <p className="mt-3 text-lg leading-relaxed text-ink-2">{copy.activateBody}</p>

        <label className="mt-8 block">
          <span className="text-base text-ink-2">{copy.serialLabel}</span>
          <input
            type="text"
            dir="ltr"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            value={serial}
            onChange={(event) => setSerial(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === "Enter" && serial.trim() && !working) void submit();
            }}
            className="mt-2 min-h-[56px] w-full rounded-lg border-2 border-line-strong px-4 text-2xl tracking-widest outline-none focus:border-ink"
          />
        </label>

        {problem ? (
          <div className="mt-4 rounded-lg border-2 border-ink p-4" role="alert">
            <p className="text-base leading-relaxed">{messageFor(problem, copy)}</p>
            {/*
              * The plain sentence is for the owner; the short code under it is
              * for whoever he sends a photo to. "no_signing_key" and "status_500"
              * both read as "did not finish", and only the code tells them apart.
              */}
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

        <button
          type="button"
          disabled={!serial.trim() || working}
          onClick={() => void submit()}
          className="mt-6 min-h-[56px] w-full rounded-lg bg-ink text-lg font-semibold text-on-ink disabled:opacity-30"
        >
          {working ? copy.activating : copy.activateButton}
        </button>

        <p className="mt-4 text-base leading-relaxed text-ink-3">{copy.activateNeedsInternet}</p>
      </div>
    </div>
  );
}
