import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type AppInfo, type BackupInfo, type LicenceState, type Paper, type Preferences, type Theme, type UiLanguage } from "../bridge";
import { copyFor, daysLeftLine } from "../i18n";
import { fill, type ScreensCopy } from "../i18n/screens";
import { Button, Choices, Confirm, Notice, ScreenHeader, Toggle, when } from "../ui";

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
  const [printer, setPrinter] = useState<string>("");
  const [paper, setPaper] = useState<Paper>("80");
  const [auto, setAuto] = useState(false);
  const [backup, setBackup] = useState<BackupInfo | null>(null);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const [restoring, setRestoring] = useState<{ sales: number } | null>(null);

  const reload = useCallback(() => {
    void machine.printSettings().then((settings) => {
      setPrinter(settings.printer ?? "");
      setPaper(settings.paper);
      setAuto(settings.auto);
    });
    void machine.printers().then(setPrinters);
    void machine.backupInfo().then(setBackup);
  }, []);

  useEffect(reload, [reload]);

  const savePrinting = (next: { printer?: string; paper?: Paper; auto?: boolean }) => {
    const merged = { printer: next.printer ?? printer, paper: next.paper ?? paper, auto: next.auto ?? auto };
    setPrinter(merged.printer);
    setPaper(merged.paper);
    setAuto(merged.auto);
    void machine.savePrintSettings({ printer: merged.printer || null, paper: merged.paper, auto: merged.auto });
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
              <p className="mt-3 text-ink-3">{t.shopNote}</p>
            </div>
          </section>

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
              <div>
                <div className="mb-1 text-base text-ink-2">{t.paper}</div>
                <Choices<Paper>
                  value={paper}
                  onChange={(value) => savePrinting({ paper: value })}
                  options={[
                    { value: "80", label: t.paper80 },
                    { value: "58", label: t.paper58 },
                    { value: "a4", label: t.paperA4 },
                  ]}
                />
              </div>
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
