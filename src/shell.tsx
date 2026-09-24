import type { ReactNode } from "react";
import type { Configuration } from "@app-ui/index";
import { isRightToLeft } from "@app-ui/format";
import type { Copy } from "./i18n";
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
    <div dir={rtl ? "rtl" : "ltr"} className="flex h-full bg-background text-black">
      {/*
        * Down the side rather than across the top: a 1366x768 laptop has
        * width to spare and no height at all, and the till needs the height.
        */}
      {/*
        * No shop name up here: the sale screen already carries it in its own
        * header, and at this width a second copy was cut to "Pharmacie Es…".
        */}
      <nav className="flex w-[180px] shrink-0 flex-col border-e-2 border-black/10">
        {sections.map((one) => (
          <button
            key={one}
            type="button"
            onClick={() => onSection(one)}
            className={
              one === section
                ? "min-h-[56px] border-b border-black/10 bg-black px-4 text-start text-base font-semibold text-white"
                : "min-h-[56px] border-b border-black/10 px-4 text-start text-base text-black/80 active:bg-black/5"
            }
          >
            {sectionLabel(one, copy, tt)}
          </button>
        ))}

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
                  ? "min-h-[48px] w-full rounded-md border-2 border-black bg-surface p-3 text-start text-base font-semibold leading-snug text-black"
                  : "min-h-[48px] w-full rounded-md bg-black p-3 text-start text-base font-medium leading-snug text-white"
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
