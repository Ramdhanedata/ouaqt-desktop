import { describe, expect, it } from "vitest";
import { defaultConfiguration, packs } from "@app-ui/config";
import type { PeriodTotal, Summary } from "./bridge";
import { buildReport, reportText } from "./report";
import { screensFor } from "./i18n/screens";
import { statisticsFor } from "./i18n/statistics";
import { dayKey } from "./periods";

const summary = (over: Partial<Summary> = {}): Summary => ({
  net: 30000,
  gross: 30000,
  count: 3,
  average: 10000,
  voids: { count: 0, total: 0 },
  discounts: 0,
  byPayment: { cash: 20000, mobile: 10000, credit: 0, insurance: 0 },
  byFund: [],
  byApp: [{ app: "Bankily", total: 10000 }],
  itemsSold: 4,
  debtPayments: { cash: 0, mobile: 0 },
  debtByApp: [],
  owed: { customers: 0, total: 0 },
  margin: { amount: 0, coveredSales: 0, uncoveredLines: 0 },
  cashDifferences: { count: 0, total: 0 },
  expenses: { total: 5000, byCategory: [{ category: "Loyer", total: 5000 }] },
  imported: { count: 1, total: 12000 },
  ...over,
});

/* November 2026 begins on a Sunday: its first week starts in October. */
const days = (count: number, net: (index: number) => number): PeriodTotal[] =>
  Array.from({ length: count }, (_, index) => {
    const from = new Date(2026, 10, 1 + index);
    return { start: dayKey(from), from: from.toISOString(), to: new Date(2026, 10, 2 + index).toISOString(), net: net(index), count: net(index) > 0 ? 1 : 0 };
  });

const make = (language: "fr" | "ar" | "en", unit: "week" | "month", list: PeriodTotal[]) =>
  buildReport({
    configuration: { ...defaultConfiguration("shop", language), business: { nameLatin: "Test" } },
    t: screensFor(language),
    st: statisticsFor(language),
    unit,
    label: "",
    dates: "novembre 2026",
    summary: summary(),
    before: { net: 20000, soFar: false },
    days: list,
    top: [{ productId: "p", name: "Sucre", quantity: 4, total: 30000 }],
    showMargin: false,
    now: new Date(2026, 10, 30, 20),
  });

describe("the period's report", () => {
  it("says the total, day by day with the dates, and how it compares", () => {
    const report = make("fr", "month", days(30, (index) => (index === 2 ? 20000 : index === 9 ? 10000 : 0)));
    expect(report.total).toContain("300");
    const rows = report.sections.flatMap((section) => section.rows);
    expect(rows.find((row) => row.label === "Meilleur jour")?.note).toContain("03/11/2026");
    expect(rows.find((row) => row.label === "Période précédente")?.note?.replace(/\s/g, " ")).toBe("+50 %");
    expect(rows.find((row) => row.label === "Dont importées d'Excel")).toBeTruthy();
    expect(rows.find((row) => row.label.startsWith("Bénéfice"))?.value).toContain("250");
    const byDay = report.sections.find((section) => section.heading === "Jour par jour");
    expect(byDay?.rows).toHaveLength(30);
  });

  it("names a month's weeks by their own days in that month", () => {
    const report = make("fr", "month", days(30, () => 1000));
    const weeks = report.sections.find((section) => section.heading === "Semaine par semaine")!.rows;
    expect(weeks[0].label).toBe("Du 01/11/2026 au 01/11/2026");
    expect(weeks[1].label).toBe("Du 02/11/2026 au 08/11/2026");
    expect(weeks[weeks.length - 1].label).toBe("Du 30/11/2026 au 30/11/2026");
  });

  it("leaves out the days still to come", () => {
    const report = buildReport({ ...{}, ...makeInput(new Date(2026, 10, 3, 12)) });
    expect(report.sections.find((section) => section.heading === "Jour par jour")?.rows).toHaveLength(3);
  });

  it.each(packs)("%s reads in the three languages, and as text for a message", (pack) => {
    for (const language of ["fr", "ar", "en"] as const) {
      const report = buildReport({
        configuration: { ...defaultConfiguration(pack, language), business: { nameLatin: "Test" } },
        t: screensFor(language),
        st: statisticsFor(language),
        unit: "week",
        label: "",
        dates: "02/11/2026 – 08/11/2026",
        summary: summary(),
        before: null,
        days: days(7, () => 1000),
        top: [],
        showMargin: true,
        now: new Date(2026, 10, 9),
      });
      expect(report.title).toBe(statisticsFor(language).reportWeek);
      const text = reportText(report, "Boutique");
      expect(text).toContain("Boutique");
      expect(text).toContain(report.total);
      expect(text).toContain("02/11/2026");
    }
  });
});

function makeInput(now: Date) {
  return {
    configuration: { ...defaultConfiguration("shop", "fr"), business: { nameLatin: "Test" } },
    t: screensFor("fr"),
    st: statisticsFor("fr"),
    unit: "month" as const,
    label: "",
    dates: "novembre 2026",
    summary: summary(),
    before: null,
    days: days(30, () => 1000),
    top: [],
    showMargin: false,
    now,
  };
}
