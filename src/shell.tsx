import type { ReactNode } from "react";
import type { Configuration } from "@app-ui/index";
import { isRightToLeft } from "@app-ui/format";
import type { Copy } from "./i18n";
import { icons, type IconName } from "./icons";
import { tradesFor, type TradesCopy } from "./i18n/trades";

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
  | "dashboard"
  | "sale"
  | "tables"
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
        return ["tables", "menu"];
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
      case "general":
        return [
          "dashboard",
          "sale",
          ...(features.general?.trackStock !== false && (features.general?.sells ?? ["products"]).includes("products") ? (["stock"] as Section[]) : ["menu" as Section]),
          ...(features.general?.expenses !== false ? (["expenses"] as Section[]) : []),
        ];
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
  dashboard: "navDashboard",
  tables: "navTables",
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
  expenses: "navExpenses",
};

/* One picture per section, so the side reads at a glance and not only by its words. */
const sectionIcons: Record<Section, IconName> = {
  dashboard: "dashboard",
  sale: "sale",
  tables: "tables",
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
  stock: "stock",
  expenses: "expenses",
  customers: "customers",
  cash: "cash",
  reports: "reports",
  settings: "settings",
};

/*
 * The shop's own mark, at the top of the side on every screen: its logo with
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

  return (
    <div dir={rtl ? "rtl" : "ltr"} className="flex h-full bg-background text-ink">
      {/*
        * Down the side rather than across the top: a 1366x768 laptop has
        * width to spare and no height at all, and the till needs the height.
        */}
      <nav className="flex w-[220px] shrink-0 flex-col overflow-y-auto border-e-2 border-line">
        <ShopMark configuration={configuration} onHome={() => onSection(sections[0])} />
        {sections.map((one) => {
          const Icon = icons[sectionIcons[one]];
          return (
            <button
              key={one}
              type="button"
              onClick={() => onSection(one)}
              aria-current={one === section ? "page" : undefined}
              className={`flex min-h-[52px] items-center gap-3 border-b border-line px-4 text-start text-base ${
                one === section ? "bg-ink font-semibold text-on-ink" : "text-ink-2 hover:bg-hover active:bg-hover"
              }`}
            >
              <Icon className="shrink-0" />
              <span className="min-w-0">{sectionLabel(one, copy, tt)}</span>
            </button>
          );
        })}

        {/*
          * What just happened, in the empty space under the sections. Up
          * here it covers nothing and moves nothing, which matters: a banner
          * over the screen hid the header, and one that pushed the screen
          * down would move the products under a finger already on its way.
          */}
        <div className="mt-auto p-3" aria-live="polite">
          {note ? (
            <button
              type="button"
              onClick={onDismissNote}
              className={
                note.kind === "failed"
                  ? "min-h-[48px] w-full rounded-md border-2 border-danger bg-danger-soft p-3 text-start text-base font-semibold leading-snug text-ink"
                  : "min-h-[48px] w-full rounded-md bg-ink p-3 text-start text-base font-medium leading-snug text-on-ink"
              }
            >
              {note.text}
            </button>
          ) : null}
        </div>
      </nav>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
