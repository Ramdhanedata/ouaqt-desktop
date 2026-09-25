import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type AppInfo, type BackupInfo, type LicenceState, type Preferences, type Theme, type UiLanguage } from "../bridge";
import { copyFor, daysLeftLine } from "../i18n";
import { fill, type ScreensCopy } from "../i18n/screens";
import { Button, Choices, Confirm, Notice, ScreenHeader, Toggle, when } from "../ui";
import { PaymentAppsSettings } from "../payment-apps";
import { ColumnsSettings } from "../columns";

/*
 * The few things set on this computer: the printer, the backups. The shop's
 * own details are shown but not edited here, because they belong to the
 * account on the website and a second copy edited in two places is how two
 * receipts end up with two addresses.
 */

export function Settings({
  configuration,
  t,
  info,
  licence,
  prefs,
  onPrefs,
  extra,
}: {
  configuration: Configuration;
  t: ScreensCopy;
  info: AppInfo | null;
  licence: LicenceState | null;
  /* The language and the theme chosen on this computer; changing either applies at once. */
  prefs: Preferences;
  onPrefs: (next: Partial<Preferences>) => void;
  /* A trade's own settings: a warehouse's places. */
  extra?: ReactNode;
}) {
  const language = configuration.language.app;
  const { business } = configuration;
  const [printers, setPrinters] = useState<{ name: string; label: string }[]>([]);
  const [team, setTeam] = useState<{ name: string; role: "manager" | "cashier" }[]>([]);
  useEffect(() => {
    void machine.staffList().then((answer) => answer.ok && setTeam(answer.value));
  }, []);
  const [printer, setPrinter] = useState<string>("");
  const [auto, setAuto] = useState(false);
  const [backup, setBackup] = useState<BackupInfo | null>(null);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const [restoring, setRestoring] = useState<{ sales: number } | null>(null);
  const [serial, setSerial] = useState<string | null>(null);

  const reload = useCallback(() => {
    void machine.printSettings().then((settings) => {
      setPrinter(settings.printer ?? "");
      setAuto(settings.auto);
    });
    void machine.printers().then(setPrinters);
    void machine.backupInfo().then(setBackup);
    void machine.licenceSerial().then(setSerial);
  }, []);

  useEffect(reload, [reload]);

  /* The printer and printing after each sale. The paper is not asked: receipts on 80 mm, reports on A4. */
  const savePrinting = (next: { printer?: string; auto?: boolean }) => {
    const merged = { printer: next.printer ?? printer, auto: next.auto ?? auto };
    setPrinter(merged.printer);
    setAuto(merged.auto);
    void machine.savePrintSettings({ printer: merged.printer || null, auto: merged.auto });
  };

  async function test() {
    const printed = await machine.printTest();
    setNote({ text: printed.ok ? t.printed : t.notPrinted, kind: printed.ok ? "done" : "problem" });
  }

  async function saveBackup() {
    const answer = await machine.backupSave();
    if (!answer.ok) setNote({ text: t.backupFailed, kind: "problem" });
    else if (answer.value) setNote({ text: fill(t.backupDone, { file: answer.value }), kind: "done" });
    reload();
  }

  async function pickRestore() {
    const answer = await machine.backupPick();
    if (!answer.ok) {
      setNote({ text: answer.reason === "other_shop" ? t.restoreOtherShop : t.restoreUnreadable, kind: "problem" });
      return;
    }
    if (answer.value) setRestoring(answer.value);
  }

  const copy = copyFor(language);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t.settingsTitle} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-3xl space-y-8">
          {note ? <Notice kind={note.kind} text={note.text} /> : null}

          <section>
            <h2 className="text-xl font-semibold">{t.shopSection}</h2>
            <div className="mt-3 rounded-lg border-2 border-line p-4 text-base leading-relaxed">
              <div className="text-lg font-semibold">{business.nameLatin}</div>
              {business.nameArabic ? <div>{business.nameArabic}</div> : null}
              {business.address ? <div>{business.address}</div> : null}
              {business.phone ? <bdi dir="ltr" className="block">{business.phone}</bdi> : null}
              {business.logo || business.logoMono ? (
                <div className="mt-4 flex flex-wrap gap-6">
                  {business.logo ? (
                    <figure>
                      <div className="flex h-24 w-40 items-center justify-center rounded-lg bg-logo-chip p-2">
                        <img src={business.logo} alt="" className="max-h-full max-w-full object-contain" />
                      </div>
                      <figcaption className="mt-1 text-ink-3">{t.logoScreen}</figcaption>
                    </figure>
                  ) : null}
                  {business.logoMono ? (
                    <figure>
                      <div className="flex h-24 w-40 items-center justify-center rounded-lg bg-white p-2">
                        <img src={business.logoMono} alt="" className="max-h-full max-w-full object-contain" />
                      </div>
                      <figcaption className="mt-1 text-ink-3">{t.logoReceipt}</figcaption>
                    </figure>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-ink-3">{t.noLogo}</p>
              )}
              <p className="mt-3 text-ink-3">{t.shopNote}</p>
            </div>
          </section>

          {team.length > 0 ? (
            <section>
              <h2 className="text-xl font-semibold">{t.teamSection}</h2>
              <ul className="mt-3 divide-y divide-line rounded-lg border-2 border-line">
                {team.map((person) => (
                  <li key={`${person.name}:${person.role}`} className="flex items-center justify-between gap-3 px-4 py-3 text-base">
                    <span className="font-semibold">{person.name}</span>
                    <span className="text-ink-3">{person.role === "manager" ? t.roleManager : t.roleCashier}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-base text-ink-3">{t.teamNote}</p>
            </section>
          ) : null}

          <section>
            <h2 className="text-xl font-semibold">{t.displaySection}</h2>
            <div className="mt-3 space-y-4">
              <div>
                <div className="mb-1 text-base text-ink-2">{t.languageLabel}</div>
                {/* Each language named in itself, so whoever reads it can find his own. */}
                <Choices<UiLanguage>
                  value={prefs.language ?? language}
                  onChange={(value) => onPrefs({ language: value })}
                  options={[
                    { value: "ar", label: "العربية" },
                    { value: "fr", label: "Français" },
                    { value: "en", label: "English" },
                  ]}
                />
              </div>
              <div>
                <div className="mb-1 text-base text-ink-2">{t.themeLabel}</div>
                <Choices<Theme>
                  value={prefs.theme}
                  onChange={(value) => onPrefs({ theme: value })}
                  options={[
                    { value: "light", label: t.themeLight },
                    { value: "dark", label: t.themeDark },
                  ]}
                />
              </div>
            </div>
          </section>

          <PaymentAppsSettings t={t} />

          <ColumnsSettings configuration={configuration} t={t} />

          {extra}

          <section>
            <h2 className="text-xl font-semibold">{t.printSection}</h2>
            <div className="mt-3 space-y-4">
              <label className="block">
                <span className="text-base text-ink-2">{t.printer}</span>
                <select
                  value={printer}
                  onChange={(event) => savePrinting({ printer: event.target.value })}
                  className="mt-1 min-h-[48px] w-full rounded-lg border-2 border-line-strong bg-surface px-3 text-base"
                >
                  <option value="">{t.defaultPrinter}</option>
                  {printers.map((one) => (
                    <option key={one.name} value={one.name}>
                      {one.label}
                    </option>
                  ))}
                </select>
              </label>
              <Toggle label={t.autoPrint} checked={auto} onChange={(value) => savePrinting({ auto: value })} />
              <Button onClick={() => void test()}>{t.testPrint}</Button>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold">{t.backupSection}</h2>
            <div className="mt-3 space-y-3 text-base leading-relaxed">
              <p>{t.backupAuto}</p>
              <p className="text-ink-2">
                {backup?.lastAutomatic ? fill(t.backupLast, { when: when(backup.lastAutomatic, language) }) : t.backupNever}
              </p>
              {backup?.lastManual ? <p className="text-ink-2">{fill(t.backupManualLast, { when: when(backup.lastManual, language) })}</p> : null}
              <p className="font-semibold">{t.backupAdvice}</p>
              <div className="flex flex-wrap gap-2">
                <Button kind="primary" onClick={() => void saveBackup()}>
                  {t.backupNow}
                </Button>
                <Button onClick={() => void pickRestore()}>{t.restore}</Button>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold">{t.licenceSection}</h2>
            <div className="mt-3 text-base leading-relaxed">
              {licence?.kind === "ok" ? (
                <>
                  <div className="font-semibold">{licence.businessName}</div>
                  <div>
                    {licence.status === "trial" && licence.daysLeft !== null
                      ? daysLeftLine(copy, language, licence.daysLeft)
                      : licence.status === "trial"
                        ? t.licenceTrial
                        : t.licenceActive}
                  </div>
                  {serial ? (
                    <div className="mt-1 text-ink-2">
                      {copy.yourSerial} : <bdi dir="ltr" className="font-semibold tracking-wider text-ink">{serial}</bdi>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold">{t.aboutSection}</h2>
            <p className="mt-3 text-base text-ink-2">{info ? fill(t.version, { version: info.version }) : ""}</p>
          </section>
        </div>
      </div>

      {restoring ? (
        <Confirm
          title={t.restoreTitle}
          body={fill(t.restoreBody, { sales: restoring.sales })}
          yes={t.restoreYes}
          no={t.cancel}
          onNo={() => setRestoring(null)}
          onYes={() => {
            setRestoring(null);
            void machine.backupRestore().then((answer) => {
              if (!answer.ok) setNote({ text: t.restoreUnreadable, kind: "problem" });
            });
          }}
        />
      ) : null}
    </div>
  );
}
