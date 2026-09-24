import { useCallback, useEffect, useState } from "react";
import { machine, type PaymentApp } from "./bridge";
import { fill, type ScreensCopy } from "./i18n/screens";
import { icons } from "./icons";
import { Button, Confirm, Field } from "./ui";

/*
 * Payment through an application: Bankily, Masrvi, SEDAD, or whatever the
 * owner keeps in his own list. At the till, one tap on "Application" opens
 * the list, one tap on the one the customer used chooses it, and a field for
 * the transaction number waits under it, empty, never in the way. The app
 * connects to none of them and checks nothing: it records what he tells it.
 *
 * The list is his, in Settings: add, rename, reorder, remove, and a small
 * picture for each, which a cashier recognises faster than the word.
 */

export type AppChoice = { name: string; logo: string | null; reference: string };

/* Asks the window to show another section: here, Settings, from inside a dialog. */
export function openSettings(): void {
  window.dispatchEvent(new CustomEvent("ouaqt:section", { detail: "settings" }));
}

function usePaymentApps() {
  const [apps, setApps] = useState<PaymentApp[] | null>(null);
  const reload = useCallback(() => {
    void machine.paymentApps().then((answer) => setApps(answer.ok ? answer.value : []));
  }, []);
  useEffect(reload, [reload]);
  return { apps, reload };
}

function AppMark({ app, size = 32 }: { app: { name: string; logo: string | null }; size?: number }) {
  return app.logo ? (
    <img src={app.logo} alt="" width={size} height={size} className="shrink-0 rounded object-contain" style={{ width: size, height: size }} />
  ) : (
    <icons.phone size={size * 0.75} className="shrink-0 text-ink-3" />
  );
}

/* The application part of a payment: which one, then the optional transaction number. */
export function AppPayment({
  t,
  value,
  onChange,
}: {
  t: ScreensCopy;
  value: AppChoice | null;
  onChange: (value: AppChoice | null) => void;
}) {
  const { apps } = usePaymentApps();
  const [open, setOpen] = useState(value === null);

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex min-h-[56px] items-center justify-between gap-3 rounded-lg border-2 border-line-strong bg-surface px-3">
          <span className="flex items-center gap-3 text-lg font-semibold">
            <AppMark app={value} />
            {value.name}
          </span>
          <Button kind="quiet" onClick={() => setOpen(true)}>
            {t.changeApp}
          </Button>
        </div>
      ) : (
        <Button wide onClick={() => setOpen(true)}>
          {t.chooseApp}
        </Button>
      )}
      {value ? (
        <Field
          label={t.paymentReference}
          hint={t.paymentReferenceHint}
          value={value.reference}
          onChange={(reference) => onChange({ ...value, reference })}
          ltr
        />
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6" onMouseDown={() => setOpen(false)}>
          <div
            className="w-full max-w-lg rounded-xl bg-raised p-6 shadow-2xl"
            role="dialog"
            aria-label={t.whichApp}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 className="text-xl font-semibold">{t.whichApp}</h2>
            {apps === null ? null : apps.length === 0 ? (
              <div className="mt-4 space-y-4">
                <p className="text-base leading-relaxed text-ink-2">{t.noApps}</p>
                <Button
                  kind="primary"
                  onClick={() => {
                    setOpen(false);
                    openSettings();
                  }}
                >
                  {t.openSettings}
                </Button>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {apps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => {
                      onChange({ name: app.name, logo: app.logo, reference: value?.name === app.name ? value.reference : "" });
                      setOpen(false);
                    }}
                    className={`flex min-h-[64px] items-center gap-3 rounded-lg border-2 px-4 text-start text-lg font-semibold hover:bg-hover ${
                      value?.name === app.name ? "border-ink" : "border-line-strong"
                    }`}
                  >
                    <AppMark app={app} />
                    <span className="min-w-0 break-words">{app.name}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-6 flex justify-end">
              <Button onClick={() => setOpen(false)}>{t.cancel}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/*
 * A picture chosen from the computer, made small: a square of 64 pixels,
 * kept whole inside it, never cropped. PNG, JPG and SVG are all turned into a
 * PNG, which is what the database keeps.
 */
async function smallPicture(file: File): Promise<string | null> {
  if (!["image/png", "image/jpeg", "image/svg+xml"].includes(file.type)) return null;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const side = 64; // not-a-rule: the size the dialog shows it at, twice over
    const ratio = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;
    const width = ratio >= 1 ? side : Math.round(side * ratio);
    const height = ratio >= 1 ? Math.round(side / ratio) : side;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, (side - width) / 2, (side - height) / 2, width, height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* The list as the owner keeps it, in Settings. */
export function PaymentAppsSettings({ t }: { t: ScreensCopy }) {
  const { apps, reload } = usePaymentApps();
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<PaymentApp | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const after = (answer: { ok: boolean }) => {
    setProblem(answer.ok ? null : t.appNotSaved);
    reload();
  };

  return (
    <section>
      <h2 className="text-xl font-semibold">{t.appsSection}</h2>
      <p className="mt-2 text-base leading-relaxed text-ink-2">{t.appsIntro}</p>

      <ul className="mt-3 divide-y divide-line rounded-lg border-2 border-line">
        {(apps ?? []).map((app, index) => (
          <li key={app.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <label className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 border-line-strong hover:bg-hover" title={t.appLogo}>
              <AppMark app={app} />
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  void smallPicture(file).then((logo) => {
                    if (!logo) return setProblem(t.appLogoUnreadable);
                    void machine.setPaymentAppLogo(app.id, logo).then(after);
                  });
                }}
              />
            </label>
            <input
              defaultValue={app.name}
              aria-label={t.appName}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next && next !== app.name) void machine.renamePaymentApp(app.id, next).then(after);
                else event.target.value = app.name;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
              className="min-h-[48px] min-w-0 flex-1 rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink"
            />
            {app.logo ? (
              <Button kind="quiet" onClick={() => void machine.setPaymentAppLogo(app.id, null).then(after)}>
                {t.removeLogo}
              </Button>
            ) : null}
            <button
              type="button"
              aria-label={t.moveUp}
              disabled={index === 0}
              onClick={() => void machine.movePaymentApp(app.id, "up").then(after)}
              className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-line-strong hover:bg-hover disabled:opacity-30"
            >
              <icons.up />
            </button>
            <button
              type="button"
              aria-label={t.moveDown}
              disabled={index === (apps ?? []).length - 1}
              onClick={() => void machine.movePaymentApp(app.id, "down").then(after)}
              className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-line-strong hover:bg-hover disabled:opacity-30"
            >
              <icons.down />
            </button>
            <Button onClick={() => setRemoving(app)}>{t.removeApp}</Button>
          </li>
        ))}
        {apps && apps.length === 0 ? <li className="px-3 py-4 text-base text-ink-2">{t.noAppsYet}</li> : null}
      </ul>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <Field
            label={t.appName}
            value={name}
            onChange={setName}
            onEnter={() => {
              if (!name.trim()) return;
              void machine.addPaymentApp(name).then((answer) => {
                after(answer);
                if (answer.ok) setName("");
              });
            }}
          />
        </div>
        <Button
          kind="primary"
          disabled={!name.trim()}
          onClick={() =>
            void machine.addPaymentApp(name).then((answer) => {
              after(answer);
              if (answer.ok) setName("");
            })
          }
        >
          {t.addApp}
        </Button>
      </div>
      {problem ? <p className="mt-2 text-base font-semibold text-danger">{problem}</p> : null}

      {removing ? (
        <Confirm
          title={fill(t.removeAppTitle, { name: removing.name })}
          body={t.removeAppBody}
          yes={t.removeApp}
          no={t.cancel}
          onNo={() => setRemoving(null)}
          onYes={() => {
            const id = removing.id;
            setRemoving(null);
            void machine.removePaymentApp(id).then(after);
          }}
        />
      ) : null}
    </section>
  );
}
