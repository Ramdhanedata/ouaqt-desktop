import type { ReactNode } from "react";
import type { Configuration } from "@app-ui/index";
import { isRightToLeft } from "@app-ui/format";
import type { Copy } from "./i18n";

/*
 * The window around the screens: which sections this shop has, and the strip
 * that switches between them.
 *
 * The sections come from the configuration, not from a list in here. A shop
 * that does not sell on credit has no Clients section, and a one-person shop
 * that never closes a till has no Caisse. An owner should not have to learn
 * to ignore half his own software.
 */

export type Section = "sale" | "stock" | "customers" | "cash" | "reports" | "settings";

export function sectionsFor(configuration: Configuration): Section[] {
  const sections: Section[] = ["sale", "stock"];

  /*
   * A shop that does not sell on credit has no Clients section. An owner
   * should not have to learn to ignore half his own software.
   */
  if (configuration.common.credit?.enabled) sections.push("customers");

  /* Every shop closes its till, daily or per shift, so this one is always here. */
  sections.push("cash", "reports", "settings");
  return sections;
}

const labels: Record<Section, keyof Copy> = {
  sale: "navSale",
  stock: "navStock",
  customers: "navCustomers",
  cash: "navCash",
  reports: "navReports",
  settings: "navSettings",
};

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
  note: string | null;
  onDismissNote: () => void;
  children: ReactNode;
}) {
  const rtl = isRightToLeft(configuration.language.app);
  const sections = sectionsFor(configuration);

  return (
    <div dir={rtl ? "rtl" : "ltr"} className="flex h-screen bg-white text-black">
      {/*
        * Down the side rather than across the top: a 1366x768 laptop has
        * width to spare and no height at all, and the till needs the height.
        */}
      <nav className="flex w-[180px] shrink-0 flex-col border-e-2 border-black/10">
        <div className="truncate border-b-2 border-black/10 px-4 py-4 text-lg font-semibold">
          {configuration.business.nameLatin}
        </div>
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
            {copy[labels[one]]}
          </button>
        ))}
      </nav>

      <main className="relative min-w-0 flex-1">
        {note ? (
          <button
            type="button"
            onClick={onDismissNote}
            className="absolute inset-x-0 top-0 z-10 min-h-[48px] w-full bg-black px-4 text-base font-medium text-white"
          >
            {note}
          </button>
        ) : null}
        {children}
      </main>
    </div>
  );
}
