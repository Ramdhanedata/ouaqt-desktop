import { createContext, useContext, useEffect, useState, type ReactNode, useRef } from "react";
import type { Configuration } from "@app-ui/index";
import { isRightToLeft } from "@app-ui/format";
import type { Copy } from "./i18n";
import { icons, type IconName } from "./icons";
import { tradesFor, type TradesCopy } from "./i18n/trades";
import { useNarrow } from "./ui";

/*
 * Where a till screen puts the day's figures and its two day buttons: in the
 * bar across the top of the window, beside the sections, instead of a second
 * bar of its own. Null on a phone, and before the bar is drawn; the screen
 * then keeps its own header.
 */
const HeaderSlot = createContext<HTMLElement | null>(null);
export function useHeaderSlot(): HTMLElement | null {
  return useContext(HeaderSlot);
}

/*
 * The window around the screens: which sections this shop has, and the strip
 * that switches between them.
 *
 * The sections come from the configuration, not from a list in here. A shop
 * that does not sell on credit has no Clients section, and a one-person shop
 * that never closes a till has no Caisse. An owner should not have to learn
 * to ignore half his own software.
 */

export type Section =
  | "sale"
  | "counter"
  | "menu"
  | "production"
  | "preorders"
  | "moves"
  | "rooms"
  | "stays"
  | "extras"
  | "trips"
  | "parcels"
  | "network"
  | "washes"
  | "services"
  | "stock"
  | "expenses"
  | "customers"
  | "cash"
  | "reports"
  | "settings";

/*
 * Each trade's own sections first, in the order its day goes, then the ones
 * every shop shares. What a shop said it does not do is simply not there.
 */
export function sectionsFor(configuration: Configuration): Section[] {
  const features = configuration.features;
  const own: Section[] = (() => {
    switch (configuration.pack) {
      case "restaurant":
        /* The counter as the owner's own restaurant app ran it: tables, when there are any, are chosen on the order. */
        return ["counter", "menu"];
      case "bakery":
        return [
          "sale",
          ...(features.bakery?.trackProduction !== false ? (["production"] as Section[]) : []),
          ...(features.bakery?.preorders !== false ? (["preorders"] as Section[]) : []),
          "stock",
        ];
      case "warehouse":
        return ["moves", "stock", ...(features.warehouse?.sellsDirect ? (["sale"] as Section[]) : [])];
      case "hotel":
        return ["rooms", "stays", ...(features.hotel?.extras !== false ? (["extras"] as Section[]) : [])];
      case "transport":
        /* Departures always: a parcel, too, leaves on one. */
        return ["trips", ...((features.transport?.carries ?? []).includes("parcels") ? (["parcels"] as Section[]) : []), "network"];
      case "wash":
        return ["washes", "services"];
      case "general":
        /* The till first, as in every other shop: the month's sales and spending are in Statistiques. */
        return [
          "sale",
          ...(features.general?.trackStock !== false && (features.general?.sells ?? ["products"]).includes("products") ? (["stock"] as Section[]) : ["menu" as Section]),
          ...(features.general?.expenses !== false ? (["expenses"] as Section[]) : []),
        ];
      case "pharmacy":
        /* The till, then the stock: the day's sales are under Historique and the rest in Statistiques. */
        return ["sale", "stock"];
      default:
        return ["sale", "stock"];
    }
  })();

  const sections: Section[] = [...own];
  /*
   * A shop that does not sell on credit has no Clients section. An owner
   * should not have to learn to ignore half his own software.
   */
  if (configuration.common.credit?.enabled) sections.push("customers");

  /* Every shop closes its till, daily or per shift, so this one is always here. */
  sections.push("cash", "reports", "settings");
  return [...new Set(sections)];
}

const shared: Partial<Record<Section, keyof Copy>> = {
  sale: "navSale",
  stock: "navStock",
  customers: "navCustomers",
  cash: "navCash",
  reports: "navReports",
  settings: "navSettings",
};

const trades: Partial<Record<Section, keyof TradesCopy>> = {
  counter: "navCounter",
  menu: "navMenu",
  production: "navProduction",
  preorders: "navPreorders",
  moves: "navMoves",
  rooms: "navRooms",
  stays: "navStays",
  extras: "navExtras",
  trips: "navTrips",
  parcels: "navParcels",
  network: "navNetwork",
  washes: "navWashes",
  services: "navServices",
  expenses: "navExpenses",
};

/* One picture per section, so the side reads at a glance and not only by its words. */
const sectionIcons: Record<Section, IconName> = {
  sale: "sale",
  counter: "sale",
  menu: "menu",
  production: "production",
  preorders: "preorders",
  moves: "moves",
  rooms: "rooms",
  stays: "stays",
  extras: "extras",
  trips: "trips",
  parcels: "parcels",
  network: "network",
  washes: "wash",
  services: "menu",
  stock: "stock",
  expenses: "expenses",
  customers: "customers",
  cash: "cash",
  reports: "reports",
  settings: "settings",
};

/*
 * The shop's own mark, at the top of the phone's More sheet: its logo with
 * real room, and its name under it in the app's own type. With no logo, the
 * name alone, larger, and no empty box. In dark mode a logo drawn dark on
 * nothing would vanish, so it sits on a light chip rather than being
 * inverted. Pressing it goes back to the first screen.
 */
function ShopMark({ configuration, onHome }: { configuration: Configuration; onHome: () => void }) {
  const { business } = configuration;
  const name = (configuration.language.app === "ar" && business.nameArabic) || business.nameLatin;
  const logo = business.logo;
  return (
    <button
      type="button"
      onClick={onHome}
      aria-label={name}
      className="flex w-full flex-col items-center gap-2 border-b border-line px-3 py-4 text-center hover:bg-hover focus:outline-none focus-visible:bg-hover"
    >
      {logo ? (
        <span className="flex h-24 w-full items-center justify-center rounded-lg bg-logo-chip p-2">
          <img src={logo} alt="" className="max-h-full max-w-full object-contain" />
        </span>
      ) : null}
      <span className={`w-full break-words leading-snug text-ink ${logo ? "text-base font-semibold" : "text-xl font-bold"}`}>{name}</span>
    </button>
  );
}

export function sectionLabel(section: Section, copy: Copy, tt: TradesCopy): string {
  const one = shared[section];
  if (one) return copy[one];
  return tt[trades[section] as keyof TradesCopy];
}

export function Shell({
  configuration,
  copy,
  section,
  onSection,
  note,
  onDismissNote,
  children,
}: {
  configuration: Configuration;
  copy: Copy;
  section: Section;
  onSection: (section: Section) => void;
  note: { text: string; kind: "done" | "failed" | "info" } | null;
  onDismissNote: () => void;
  children: ReactNode;
}) {
  const rtl = isRightToLeft(configuration.language.app);
  const sections = sectionsFor(configuration);
  const tt = tradesFor(configuration.language.app);
  const narrow = useNarrow();

  if (narrow) {
    return (
      <PhoneShell
        configuration={configuration}
        copy={copy}
        section={section}
        sections={sections}
        onSection={onSection}
        note={note}
        onDismissNote={onDismissNote}
        rtl={rtl}
        tt={tt}
      >
        {children}
      </PhoneShell>
    );
  }

  return (
    <DesktopShell
      configuration={configuration}
      copy={copy}
      section={section}
      sections={sections}
      onSection={onSection}
      note={note}
      onDismissNote={onDismissNote}
      rtl={rtl}
      tt={tt}
    >
      {children}
    </DesktopShell>
  );
}

/*
 * The window on a computer: one white bar across the top, the way the till
 * the owner chose draws it. The shop's mark at the start; the day's figures
 * and the day's two buttons at the end, put there by the till screen through
 * HeaderSlot; under them, the sections as large buttons, the open one filled
 * in blue. The screen gets the whole width under the bar.
 *
 * What just happened shows in a card at the bottom corner, where it covers
 * the least and moves nothing under a finger already on its way.
 */
function DesktopShell({
  configuration,
  copy,
  section,
  sections,
  onSection,
  note,
  onDismissNote,
  rtl,
  tt,
  children,
}: {
  configuration: Configuration;
  copy: Copy;
  section: Section;
  sections: Section[];
  onSection: (section: Section) => void;
  note: { text: string; kind: "done" | "failed" | "info" } | null;
  onDismissNote: () => void;
  rtl: boolean;
  tt: TradesCopy;
  children: ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const { business } = configuration;
  const name = (configuration.language.app === "ar" && business.nameArabic) || business.nameLatin;

  return (
    <div dir={rtl ? "rtl" : "ltr"} data-section={section} className="flex h-full flex-col bg-background text-ink">
      <header className="shrink-0 border-b border-line bg-surface px-5 pt-2.5 pb-2">
        <div className="flex min-h-[60px] items-center gap-3">
          <button
            type="button"
            onClick={() => onSection(sections[0])}
            className="me-auto flex min-w-0 items-center gap-3 rounded-lg py-1 pe-2 hover:bg-hover focus:outline-none focus-visible:bg-hover"
          >
            {business.logo ? (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-logo-chip p-1">
                <img src={business.logo} alt="" className="max-h-full max-w-full object-contain" />
              </span>
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent-soft font-display text-xl font-bold text-accent-strong">
                {Array.from(name.trim())[0] ?? ""}
              </span>
            )}
            <span className="truncate text-lg font-bold">{name}</span>
          </button>
          <div ref={setSlot} className="flex shrink-0 items-center gap-2" />
        </div>
        <nav className="mt-2 flex flex-wrap gap-2">
          {sections.map((one) => {
            const Icon = icons[sectionIcons[one]];
            const open = one === section;
            return (
              <button
                key={one}
                type="button"
                onClick={() => onSection(one)}
                aria-current={open ? "page" : undefined}
                className={`flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-base ${
                  open
                    ? "bg-accent font-semibold text-accent-foreground shadow-main"
                    : "border border-line bg-surface text-ink-2 shadow-card hover:border-line-strong hover:text-ink"
                }`}
              >
                <Icon size={19} className="shrink-0" />
                <span className="whitespace-nowrap">{sectionLabel(one, copy, tt)}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <HeaderSlot.Provider value={slot}>
        <main className="min-h-0 min-w-0 flex-1">{children}</main>
      </HeaderSlot.Provider>

      {note ? (
        <div className="pointer-events-none fixed bottom-4 start-4 z-40 w-[320px] max-w-[calc(100%-2rem)]" aria-live="polite">
          <button
            type="button"
            onClick={onDismissNote}
            className={`pointer-events-auto min-h-[48px] w-full rounded-xl p-3 text-start text-base font-semibold leading-snug shadow-card ${
              note.kind === "failed" ? "border-2 border-danger bg-danger-soft text-ink" : "bg-ink text-on-ink"
            }`}
          >
            {note.text}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/*
 * The same window on a phone. The sections move from the side to the bottom,
 * where a thumb reaches them, and the screen above gets the whole width.
 *
 * Five at most along the bottom, as everywhere else (rule 3): a shop with
 * more keeps its first four there, the ones its day goes through, and the
 * rest behind "Plus", which also carries the shop's own mark. Every tab has
 * its word under its picture (rule 5); the words are a little smaller than
 * the screens' own, because five of them share the width of a phone.
 */
const BAR_LIMIT = 5; // not-a-rule: rule 3 of docs/UI_RULES.md, five items at most in any menu

function PhoneShell({
  configuration,
  copy,
  section,
  sections,
  onSection,
  note,
  onDismissNote,
  rtl,
  tt,
  children,
}: {
  configuration: Configuration;
  copy: Copy;
  section: Section;
  sections: Section[];
  onSection: (section: Section) => void;
  note: { text: string; kind: "done" | "failed" | "info" } | null;
  onDismissNote: () => void;
  rtl: boolean;
  tt: TradesCopy;
  children: ReactNode;
}) {
  const [more, setMore] = useState(false);
  const bar = useRef<HTMLElement>(null);
  /* Statistiques always in the bar, where the owner sees it: it takes the last place before "Plus" when it would fall behind it. */
  const first = sections.slice(0, BAR_LIMIT - 1);
  const pinned = sections.length > BAR_LIMIT && sections.includes("reports") && !first.includes("reports") ? [...first.slice(0, -1), "reports" as Section] : first;
  const inBar = sections.length <= BAR_LIMIT ? sections : pinned;
  const rest = sections.length <= BAR_LIMIT ? [] : sections.filter((one) => !inBar.includes(one));
  const restOpen = rest.includes(section);

  /* A section chosen from the sheet closes it; so does going back to one in the bar. */
  useEffect(() => setMore(false), [section]);

  const tab = (key: string, label: string, Icon: (typeof icons)[IconName], active: boolean, onPress: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onPress}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 pt-2 pb-1.5 ${
        active ? "text-accent-strong" : "text-ink-3 active:bg-hover"
      }`}
    >
      <span className={`flex h-8 w-14 items-center justify-center rounded-full ${active ? "bg-accent text-accent-foreground" : ""}`}>
        <Icon size={22} className="shrink-0" />
      </span>
      <span className={`line-clamp-2 w-full hyphens-auto break-words text-center text-[13px] leading-tight ${active ? "font-semibold" : ""}`}>{label}</span>
    </button>
  );

  return (
    <div dir={rtl ? "rtl" : "ltr"} data-section={section} className="flex h-full flex-col bg-background text-ink">
      <main className="relative min-h-0 flex-1 overflow-hidden pt-[env(safe-area-inset-top)]">{children}</main>

      {/* What just happened, just above the bar, where it covers the least. */}
      {note ? (
        <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3" style={{ bottom: "calc(76px + env(safe-area-inset-bottom))" }} aria-live="polite">
          <button
            type="button"
            onClick={onDismissNote}
            className={`pointer-events-auto min-h-[48px] w-full max-w-md rounded-xl p-3 text-start text-base font-semibold leading-snug shadow-xl ${
              note.kind === "failed" ? "border-2 border-danger bg-danger-soft text-ink" : "bg-ink text-on-ink"
            }`}
          >
            {note.text}
          </button>
        </div>
      ) : null}

      <nav ref={bar} className="z-30 flex shrink-0 border-t-2 border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        {inBar.map((one) => tab(one, sectionLabel(one, copy, tt), icons[sectionIcons[one]], one === section, () => onSection(one)))}
        {rest.length > 0 ? tab("more", copy.navMore, icons.more, restOpen || more, () => setMore((open) => !open)) : null}
      </nav>

      {more ? (
        <div className="fixed inset-0 z-20 flex flex-col justify-end bg-scrim" onClick={() => setMore(false)}>
          <div
            className="max-h-[85%] overflow-y-auto rounded-t-2xl bg-surface shadow-2xl"
            /* Exactly above the bar, whose height grows when a word takes two lines: the last row is never behind it. */
            style={{ marginBottom: bar.current?.offsetHeight ?? "calc(62px + env(safe-area-inset-bottom))" }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label={copy.navMore}
          >
            <ShopMark
              configuration={configuration}
              onHome={() => {
                setMore(false);
                onSection(sections[0]);
              }}
            />
            {rest.map((one) => {
              const Icon = icons[sectionIcons[one]];
              return (
                <button
                  key={one}
                  type="button"
                  onClick={() => {
                    setMore(false);
                    onSection(one);
                  }}
                  aria-current={one === section ? "page" : undefined}
                  className={`flex min-h-[56px] w-full items-center gap-4 border-b border-line px-5 text-start text-lg ${
                    one === section ? "bg-accent-chosen font-semibold text-accent-strong" : "text-ink active:bg-hover"
                  }`}
                >
                  <Icon className="shrink-0" />
                  <span className="min-w-0">{sectionLabel(one, copy, tt)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
