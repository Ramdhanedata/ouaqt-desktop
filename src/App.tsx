import { useCallback, useEffect, useMemo, useState } from "react";
import type { Configuration } from "@app-ui/index";
import { Activation } from "./activation";
import {
  machine,
  type ActivationResult,
  type AppInfo,
  type ConfigurationResult,
  type LicenceState,
  type Preferences,
} from "./bridge";
import { LanguageChoice } from "./language";
import { LicenceEnded, LicenceReminder, remindsToRenew } from "./trial";
import { copyFor, type Copy } from "./i18n";
import { screensFor } from "./i18n/screens";
import { Cash } from "./screens/cash";
import { Customers } from "./screens/customers";
import { Reports } from "./screens/reports";
import { Sell } from "./screens/sell";
import { Settings } from "./screens/settings";
import { Stock } from "./screens/stock";
import { BakeryDay, Preorders } from "./screens/bakery";
import { Dashboard, Expenses } from "./screens/general";
import { Rooms, Stays } from "./screens/hotel";
import { Counter } from "./screens/counter";
import { SalesOverview } from "./screens/overview";
import { Network, Parcels, Trips } from "./screens/transport";
import { Moves, Places } from "./screens/warehouse";
import { tradesFor } from "./i18n/trades";
import { Shell, sectionsFor, type Section } from "./shell";

/*
 * The app, arranged around one shop's configuration.
 *
 * Nothing here knows which trade it is serving. The configuration decides the
 * language and the direction, which sections exist down the side, and what
 * the till is called. Two pharmacies run this same window with different
 * answers behind them, and so does a bakery.
 */

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [licence, setLicence] = useState<LicenceState | null>(null);
  const [linkFailure, setLinkFailure] = useState<Extract<ActivationResult, { ok: false }> | null>(null);
  const [result, setResult] = useState<ConfigurationResult | null>(null);
  const [section, setSection] = useState<Section>("sale");
  const [note, setNote] = useState<{ text: string; kind: "done" | "failed" | "info" } | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  /* The screen that says the licence ended is shown once each time the app opens, then his data. */
  const [endedSeen, setEndedSeen] = useState(false);
  const choose = useCallback((next: Partial<Preferences>) => {
    void machine.writePreferences(next as Parameters<typeof machine.writePreferences>[0]).then(setPrefs);
  }, []);

  /*
   * A sale that went through says so and then gets out of the way. One that
   * did not stays until somebody reads it.
   */
  useEffect(() => {
    if (note?.kind !== "done") return;
    const timer = setTimeout(() => setNote(null), 4000); // not-a-rule: how long a confirmation lingers
    return () => clearTimeout(timer);
  }, [note]);


  /* Everything the window shows follows from the licence, so it is read first. */
  const reload = useCallback(() => {
    void machine.licenceState().then(setLicence);
    void machine.readConfiguration().then(setResult);
  }, []);

  useEffect(() => {
    void machine.appInfo().then(setInfo);
    void machine.readPreferences().then(setPrefs);
    reload();
    /*
     * The link from step 4 activates in the main process and reports here.
     * Success reloads the shop; any failure lands on the serial screen with
     * its sentence, so a link that did not work is never a dead end.
     */
    return machine.onActivated((answer) => {
      if (answer.ok) {
        setLinkFailure(null);
        reload();
      } else {
        setLinkFailure(answer);
        reload();
      }
    });
  }, [reload]);

  /*
   * The language chosen on this computer speaks for every screen, whatever
   * the shop's configuration says: the same shop can have a cashier who reads
   * Arabic and an owner who reads French.
   */
  const configuration = useMemo(
    () =>
      result?.ok
        ? { ...result.configuration, language: { ...result.configuration.language, app: prefs?.language ?? result.configuration.language.app } }
        : null,
    [result, prefs]
  );
  const language = configuration?.language.app ?? prefs?.language ?? "fr";
  const copy = copyFor(language);

  /* Light or dark, on the whole document, so every token follows. */
  useEffect(() => {
    document.documentElement.dataset.theme = prefs?.theme ?? "light";
  }, [prefs]);

  /* An update waits for the app to close; the note stays until it is read. */
  useEffect(
    () => machine.onUpdateReady(() => setNote({ text: copyFor(language).updateReady, kind: "info" })),
    [language]
  );

  /*
   * Each trade opens on its own first section: a restaurant on its room, a
   * hotel on its rooms. A section the configuration no longer has is left.
   */
  useEffect(() => {
    if (!configuration) return;
    const available = sectionsFor(configuration);
    if (!available.includes(section)) setSection(available[0]);
  }, [configuration, section]);

  /*
   * A dialog deep in a screen can ask for another section: the payment one
   * sends to Settings, an empty till to the stock. It names the ones it would
   * take, in order, and the first this shop has is opened.
   */
  useEffect(() => {
    const go = (event: Event) => {
      const wanted = ([] as Section[]).concat((event as CustomEvent<Section | Section[]>).detail);
      const available = configuration ? sectionsFor(configuration) : [];
      const next = wanted.find((one) => available.includes(one));
      if (next) setSection(next);
    };
    window.addEventListener("ouaqt:section", go);
    return () => window.removeEventListener("ouaqt:section", go);
  }, [configuration]);

  /* The whole document turns, not only the screen: rule 13. */
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  if (!licence || !result || !prefs) return <Starting label={copy.starting} />;

  const test = info?.testBuild ? <TestBar copy={copy} server={info.server} /> : null;

  /* The very first launch: the language, before anything else. */
  if (prefs.language === null) {
    return (
      <Frame top={test}>
        <LanguageChoice onChoose={(chosen) => choose({ language: chosen })} />
      </Frame>
    );
  }

  /* No licence on this machine: the serial screen, and nothing else. */
  if (licence.kind === "none") {
    return (
      <Frame top={test}>
        <Activation
          failure={linkFailure}
          language={language}
          onLanguage={(chosen) => choose({ language: chosen })}
          onDone={() => { setLinkFailure(null); reload(); }}
        />
      </Frame>
    );
  }

  if (!result.ok || !configuration) {
    const missing = !result.ok && result.reason === "missing";
    return (
      <Message
        title={missing ? copy.noConfiguration : copy.badConfiguration}
        body={missing ? copy.noConfigurationBody : copy.badConfigurationBody}
      />
    );
  }

  const notice = licence.kind === "ok" ? noticeFor(licence, copy) : null;
  const t = screensFor(language);
  const readOnly = licence.kind === "ok" && !licence.canSell;

  const ended = licence.kind === "ok" && (licence.status === "expired_trial" || licence.status === "expired");
  if (ended && !endedSeen) {
    return (
      <Frame top={test}>
        <LicenceEnded copy={copy} language={language} licence={licence} onSeeData={() => setEndedSeen(true)} onPaid={reload} />
      </Frame>
    );
  }
  /* The trial counts down out of sight; a paid year is reminded of at its end. */
  const reminder =
    licence.kind === "ok" && remindsToRenew(licence) ? <LicenceReminder copy={copy} language={language} licence={licence} /> : null;

  /*
   * The end-of-trial summary, in the last days of the trial: what he has
   * recorded, from his own database, on his own screen. Nothing of it is
   * sent anywhere.
   */
  const trialEnding =
    licence.kind === "ok" &&
    licence.status === "trial" &&
    licence.daysLeft !== null &&
    licence.daysLeft <= licence.trialSummaryDays;

  const configurationNow = configuration;
  const tt = tradesFor(language);
  const pack = configurationNow.pack;
  const props = { configuration: configurationNow, t, readOnly };
  const tprops = { ...props, tt };
  /* What the sale screen shows beside the search: tiles for a shop that picks by eye. */
  const tiles =
    pack === "bakery" || pack === "general" || (pack === "shop" && configurationNow.features.shop?.tiles !== false) || pack === "warehouse";

  const screen = (() => {
    switch (section) {
      case "dashboard":
        return <Dashboard configuration={configurationNow} t={t} tt={tt} />;
      case "sale":
        return <Sell {...props} tiles={tiles} />;
      case "counter":
        return <Counter {...tprops} />;
      case "overview":
        return <SalesOverview configuration={configurationNow} t={t} tt={tt} />;
      case "menu":
        return (
          <Stock
            {...props}
            catalog={{
              mode: "menu",
              title: pack === "general" ? tt.navMenu : tt.menuTitle,
              newLabel: tt.newDish,
              trackLabel: pack === "general" ? tt.trackStock : undefined,
            }}
          />
        );
      case "extras":
        return <Stock {...props} catalog={{ mode: "menu", title: tt.extrasTitle, newLabel: tt.newExtra }} />;
      case "production":
        return <BakeryDay {...tprops} />;
      case "preorders":
        return <Preorders {...tprops} />;
      case "moves":
        return <Moves {...tprops} />;
      case "rooms":
        return <Rooms {...tprops} />;
      case "stays":
        return <Stays {...tprops} />;
      case "trips":
        return <Trips {...tprops} />;
      case "parcels":
        return <Parcels {...tprops} />;
      case "network":
        return <Network {...tprops} />;
      case "expenses":
        return <Expenses {...tprops} />;
      case "stock":
        return (
          <Stock
            {...props}
            catalog={{
              mode: "stock",
              /* Where services are sold beside products, each product says whether it is counted. */
              trackLabel: pack === "general" || pack === "bakery" || pack === "shop" ? tt.trackStock : undefined,
            }}
          />
        );
      case "customers":
        return <Customers {...props} />;
      case "cash":
        return <Cash {...tprops} />;
      case "reports":
        return <Reports {...tprops} showTrialSummary={trialEnding} />;
      case "settings":
        return (
          <Settings
            configuration={configurationNow}
            t={t}
            info={info}
            licence={licence}
            prefs={prefs}
            onPrefs={choose}
            extra={pack === "warehouse" ? <Places t={t} tt={tt} readOnly={readOnly} /> : null}
          />
        );
      default:
        return <Message title={copy.notBuilt} body={copy.notBuiltBody} />;
    }
  })();

  return (
    <Frame top={<>{test}{notice}{reminder}</>}>
    <Shell
      configuration={configurationNow}
      copy={copy}
      section={section}
      onSection={setSection}
      note={note}
      onDismissNote={() => setNote(null)}
    >
      {screen}
    </Shell>
    </Frame>
  );
}

/* The window's own layout: whatever bars apply, then the screen under them. */
function Frame({ top, children }: { top: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-background">
      {top}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/*
 * A test build says so, on every screen, in a bar nothing can hide. It also
 * says which website it activates against, because a test pointed at the
 * wrong one is the first thing to rule out.
 */
function TestBar({ copy, server }: { copy: Copy; server: string | null }) {
  return (
    <div className="flex min-h-[40px] shrink-0 items-center justify-between gap-4 bg-ink px-4 text-base text-on-ink">
      <span className="font-semibold">{copy.testBanner}</span>
      {server ? <bdi dir="ltr" className="text-on-ink/70">{server}</bdi> : null}
    </div>
  );
}

/*
 * What the licence means for today, when it means anything. Read-only is
 * said plainly and in full; everything recorded stays on screen under it.
 */
function noticeFor(licence: Extract<LicenceState, { kind: "ok" }>, copy: Copy) {
  const bar = (text: string, strong: boolean) => (
    <div
      role="status"
      className={
        strong
          ? "shrink-0 border-b-2 border-danger bg-danger-soft px-4 py-3 text-base font-semibold leading-snug text-ink"
          : "shrink-0 border-b border-line bg-background px-4 py-2 text-base text-ink-2"
      }
    >
      {text}
    </div>
  );

  if (licence.clockWrong) return bar(copy.clockWrong, true);
  if (licence.status === "suspended") return bar(copy.readOnlySuspended, true);
  if (licence.status === "expired_trial") return bar(copy.readOnlyTrial, true);
  if (licence.status === "expired") return bar(copy.readOnlyExpired, true);
  return null;
}

function Starting({ label }: { label: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <p className="text-lg text-ink-3">{label}</p>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-8">
      <div className="max-w-md">
        <h2 className="text-2xl font-semibold text-ink">{title}</h2>
        <p className="mt-3 text-lg leading-relaxed text-ink-2">{body}</p>
      </div>
    </div>
  );
}

export type { Configuration };
