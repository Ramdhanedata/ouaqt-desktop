import { useCallback, useEffect, useMemo, useState } from "react";
import { SaleScreen, type Configuration, type ReceiptLine } from "@app-ui/index";
import { Activation } from "./activation";
import {
  machine,
  type ActivationResult,
  type AppInfo,
  type ConfigurationResult,
  type LicenceState,
  type Product,
} from "./bridge";
import { copyFor, daysLeftLine, type Copy } from "./i18n";
import { fill, screensFor } from "./i18n/screens";
import { Cash } from "./screens/cash";
import { Customers } from "./screens/customers";
import { Reports } from "./screens/reports";
import { Sell } from "./screens/sell";
import { Settings } from "./screens/settings";
import { Stock } from "./screens/stock";
import { BakeryDay, Preorders } from "./screens/bakery";
import { Dashboard, Expenses } from "./screens/general";
import { Rooms, Stays } from "./screens/hotel";
import { Floor } from "./screens/restaurant";
import { Network, Parcels, Trips } from "./screens/transport";
import { Moves, Places } from "./screens/warehouse";
import { tradesFor } from "./i18n/trades";
import { Shell, sectionsFor, type Section } from "./shell";
import { money } from "./ui";

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
  const [products, setProducts] = useState<Product[] | null>(null);
  const [section, setSection] = useState<Section>("sale");
  const [note, setNote] = useState<{ text: string; kind: "done" | "failed" | "info" } | null>(null);

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
    void machine.products().then(setProducts);
  }, []);

  useEffect(() => {
    void machine.appInfo().then(setInfo);
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

  const configuration = result?.ok ? result.configuration : null;
  const language = configuration?.language.app ?? "fr";
  const copy = copyFor(language);

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

  /* The whole document turns, not only the screen: rule 13. */
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  /*
   * Selling, for real. The ticket stays on screen unless the sale reached the
   * disk, which is why this returns the answer rather than assuming it.
   */
  const charge = useCallback(
    async (lines: ReceiptLine[]): Promise<boolean> => {
      const answer = await machine.recordSale({
        payment: "cash",
        lines: lines.map((line) => ({
          productId: line.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      });

      if (!answer.ok) {
        setNote({
          text: answer.reason === "read_only" ? copy.saleReadOnly : copy.saleFailed,
          kind: "failed",
        });
        return false;
      }

      setNote({ text: copy.saleKept, kind: "done" });
      void machine.products().then(setProducts);
      return true;
    },
    [copy]
  );

  const forScreen = useMemo(
    () =>
      (products ?? []).map((product) => ({
        id: product.id,
        name: {
          fr: product.name,
          ar: product.nameArabic || product.name,
          en: product.name,
        },
        price: product.salePrice,
        inStock: product.onHand,
      })),
    [products]
  );

  if (!licence || !result) return <Starting label={copy.starting} />;

  const test = info?.testBuild ? <TestBar copy={copy} server={info.server} /> : null;

  /* No licence on this machine: the serial screen, and nothing else. */
  if (licence.kind === "none") {
    return (
      <Frame top={test}>
        <Activation failure={linkFailure} onDone={() => { setLinkFailure(null); reload(); }} />
      </Frame>
    );
  }

  if (!result.ok) {
    const missing = result.reason === "missing";
    return (
      <Message
        title={missing ? copy.noConfiguration : copy.badConfiguration}
        body={missing ? copy.noConfigurationBody : copy.badConfigurationBody}
      />
    );
  }

  const notice = licence.kind === "ok" ? noticeFor(licence, copy, language) : null;
  const t = screensFor(language);
  const readOnly = licence.kind === "ok" && !licence.canSell;

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

  const configurationNow = result.configuration;
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
        return <Sell {...props} tiles={tiles} onSold={() => void machine.products().then(setProducts)} />;
      case "tables":
        return <Floor {...tprops} />;
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
              batches: pack === "pharmacy",
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
        return <Settings configuration={configurationNow} t={t} info={info} licence={licence} extra={pack === "warehouse" ? <Places t={t} tt={tt} readOnly={readOnly} /> : null} />;
      default:
        return <Message title={copy.notBuilt} body={copy.notBuiltBody} />;
    }
  })();

  return (
    <Frame top={<>{test}{notice}{trialEnding ? <TrialSummaryBar language={language} /> : null}</>}>
    <Shell
      configuration={result.configuration}
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

/* The trial's last days: one line, from this computer's own records. */
function TrialSummaryBar({ language }: { language: Configuration["language"]["app"] }) {
  const [figures, setFigures] = useState<{ sales: number; creditCustomers: number; creditTotal: number; cashDifferences: number } | null>(null);
  useEffect(() => {
    void machine.trialSummary().then((answer) => answer.ok && setFigures(answer.value));
  }, []);
  if (!figures) return null;
  const t = screensFor(language);
  return (
    <div role="status" className="shrink-0 border-b border-black/10 bg-white px-4 py-2 text-base text-black">
      <span className="font-semibold">{t.trialSummaryTitle} : </span>
      {fill(t.trialSummaryBody, {
        sales: figures.sales,
        customers: figures.creditCustomers,
        credit: money(figures.creditTotal, language),
        differences: figures.cashDifferences,
      })}
    </div>
  );
}

/* The window's own layout: whatever bars apply, then the screen under them. */
function Frame({ top, children }: { top: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-white">
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
    <div className="flex min-h-[40px] shrink-0 items-center justify-between gap-4 bg-black px-4 text-base text-white">
      <span className="font-semibold">{copy.testBanner}</span>
      {server ? <bdi dir="ltr" className="text-white/70">{server}</bdi> : null}
    </div>
  );
}

/*
 * What the licence means for today, when it means anything. Read-only is
 * said plainly and in full; everything recorded stays on screen under it.
 */
function noticeFor(licence: Extract<LicenceState, { kind: "ok" }>, copy: Copy, language: string) {
  const bar = (text: string, strong: boolean) => (
    <div
      role="status"
      className={
        strong
          ? "shrink-0 border-b-2 border-black bg-white px-4 py-3 text-base font-semibold leading-snug text-black"
          : "shrink-0 border-b border-black/10 bg-white px-4 py-2 text-base text-black/70"
      }
    >
      {text}
    </div>
  );

  if (licence.clockWrong) return bar(copy.clockWrong, true);
  if (licence.status === "suspended") return bar(copy.readOnlySuspended, true);
  if (licence.status === "expired_trial") return bar(copy.readOnlyTrial, true);
  if (licence.status === "expired") return bar(copy.readOnlyExpired, true);
  if (licence.status === "trial" && licence.daysLeft !== null) {
    return bar(daysLeftLine(copy, language, licence.daysLeft), false);
  }
  return null;
}

function Starting({ label }: { label: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-white">
      <p className="text-lg text-black/60">{label}</p>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-white p-8">
      <div className="max-w-md">
        <h2 className="text-2xl font-semibold text-black">{title}</h2>
        <p className="mt-3 text-lg leading-relaxed text-black/70">{body}</p>
      </div>
    </div>
  );
}

export type { Configuration };
