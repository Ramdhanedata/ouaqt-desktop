import { describe, expect, it } from "vitest";
import { defaultConfiguration, packs, type Configuration } from "@app-ui/config";
import type { Summary } from "./bridge";
import { dayReport, type DayFacts } from "./day-report";
import { screensFor } from "./i18n/screens";
import { tradesFor } from "./i18n/trades";

const summary = (over: Partial<Summary> = {}): Summary => ({
  net: 16000,
  gross: 16000,
  count: 2,
  average: 8000,
  voids: { count: 0, total: 0 },
  discounts: 0,
  byPayment: { cash: 8000, mobile: 8000, credit: 0, insurance: 0 },
  byFund: [],
  byApp: [{ app: "Masrvi", total: 8000 }],
  itemsSold: 3,
  debtPayments: { cash: 0, mobile: 0 },
  debtByApp: [],
  owed: { customers: 0, total: 0 },
  margin: { amount: 0, coveredSales: 0, uncoveredLines: 0 },
  cashDifferences: { count: 0, total: 0 },
  expenses: { total: 0, byCategory: [] },
  ...over,
});

const shopOf = (pack: (typeof packs)[number], language: "fr" | "ar" | "en" = "fr"): Configuration => ({
  ...defaultConfiguration(pack, language),
  business: { nameLatin: "Test" },
});

const report = (pack: (typeof packs)[number], facts: Partial<DayFacts> = {}, language: "fr" | "ar" | "en" = "fr") =>
  dayReport(shopOf(pack, language), screensFor(language), tradesFor(language), { summary: summary(), top: [], ...facts }, new Date(2026, 10, 5)); // not-a-rule: a fixed day

const labels = (day: ReturnType<typeof report>) => day.sections.flatMap((section) => section.rows.map((row) => row.label));

describe("the end of the day", () => {
  it.each(packs)("%s has the same report: the takings, the count, how it was paid", (pack) => {
    const day = report(pack);
    expect(day.title).toBe("Fin de journée");
    expect(day.date).toContain("2026");
    expect(day.sections.some((section) => section.heading === "Détail des paiements")).toBe(true);
    if (pack !== "warehouse") expect(day.total.replace(/\s/g, "")).toContain("160");
  });

  it.each(["fr", "ar", "en"] as const)("says everything in %s, with nothing left to fill in", (language) => {
    for (const pack of packs) {
      const day = report(pack, { cash: null }, language);
      for (const text of [day.title, day.date, day.totalLabel, ...labels(day)]) {
        expect(text.trim().length, pack).toBeGreaterThan(0);
        expect(text, pack).not.toContain("{");
      }
    }
  });

  it("speaks each trade's own words", () => {
    expect(labels(report("restaurant"))).toContain("Nombre de commandes");
    expect(labels(report("shop"))).toContain("Nombre de ventes");
    expect(labels(report("hotel"))).toContain("Notes payées");
    expect(labels(report("transport"))).toContain("Billets et colis vendus");
    expect(labels(report("wash"))).toContain("Lavages payés");
  });

  it("shows the most sold item from the sales, not the highest takings", () => {
    const top = [
      { productId: "a", name: "Cher", quantity: 1, total: 9000 },
      { productId: "b", name: "Café", quantity: 5, total: 2000 },
    ];
    const row = report("restaurant", { top }).sections[0].rows.find((one) => one.label === "Article le plus commandé");
    expect(row?.value).toBe("Café");
    expect(row?.note).toBe("5 fois");
  });

  it("leaves a line with nothing to say out", () => {
    const quiet = labels(report("shop"));
    expect(quiet).not.toContain("Remise");
    expect(quiet).not.toContain("Annulations");
    expect(quiet).not.toContain("Crédits remboursés");
    expect(quiet).not.toContain("Dépenses");
    expect(quiet).not.toContain("Sur les comptes clients");
  });

  it("says what else moved when something did", () => {
    const busy = report("shop", {
      summary: summary({
        discounts: 500,
        voids: { count: 1, total: -2000 },
        debtPayments: { cash: 1000, mobile: 500 },
        expenses: { total: 3000, byCategory: [] },
        byPayment: { cash: 8000, mobile: 8000, credit: 4000, insurance: 0 },
      }),
    });
    expect(labels(busy)).toEqual(expect.arrayContaining(["Remise", "Annulations", "Crédits remboursés", "Dépenses", "Sur les comptes clients"]));
  });

  it("names the funds a pharmacy has to claim from", () => {
    const day = report("pharmacy", { summary: summary({ byFund: [{ payer: "cnam", total: 4000 }], byPayment: { cash: 8000, mobile: 4000, credit: 0, insurance: 4000 } }) });
    expect(labels(day).some((label) => label.includes("CNAM"))).toBe(true);
  });

  it("adds what only this trade counts", () => {
    expect(labels(report("restaurant", { services: [{ service: "takeaway", count: 2, total: 16000 }] }))).toContain(`${tradesFor("fr").takeawayShort} (2)`);
    expect(labels(report("hotel", { occupancy: { roomNights: 10, sold: 4, percent: 40 } }))).toContain("Taux d'occupation");
    expect(labels(report("transport", { routes: [{ route: "Nouakchott → Nouadhibou", tickets: 3, ticketTotal: 9000, parcels: 1, parcelTotal: 1000 }] }))).toContain("Nouakchott → Nouadhibou");
    const wash = report("wash", { wash: { jobs: 3, amount: 9000, cars: 2, upholstery: 1, byWasher: [{ washer: "Sidi", jobs: 3, amount: 9000 }] } });
    expect(labels(wash)).toEqual(expect.arrayContaining(["Voitures", "Meubles et tapis", "Sidi"]));
    expect(labels(report("bakery", { baked: [{ produced: 40, sold: 30, lost: 2 }] }))).toEqual(expect.arrayContaining(["Fabriqué", "Invendus"]));
  });

  it("keeps the average basket to the trades that have a basket", () => {
    for (const pack of ["hotel", "transport", "wash"] as const) expect(labels(report(pack)), pack).not.toContain("Panier moyen");
    for (const pack of ["restaurant", "shop", "pharmacy", "bakery", "general"] as const) expect(labels(report(pack)), pack).toContain("Panier moyen");
  });

  it("counts a route rather than adding money that would not match the takings", () => {
    const day = report("transport", { routes: [{ route: "Nouakchott → Atar", tickets: 2, ticketTotal: 120000, parcels: 1, parcelTotal: 20000 }] });
    const row = day.sections.flatMap((section) => section.rows).find((one) => one.label === "Nouakchott → Atar");
    expect(row?.value).toBe("Billets 2 · Colis 1");
  });

  it("does not name who washed for a wash that keeps no washers", () => {
    const shop = shopOf("wash");
    shop.features.wash!.washers = false;
    const day = dayReport(shop, screensFor("fr"), tradesFor("fr"), { summary: summary(), top: [], wash: { jobs: 1, amount: 100, cars: 1, upholstery: 0, byWasher: [{ washer: "Sidi", jobs: 1, amount: 100 }] } });
    expect(labels(day)).not.toContain("Sidi");
  });

  it("leads a warehouse that only moves goods with what moved, not with zero takings", () => {
    const empty = summary({ net: 0, gross: 0, count: 0, average: 0, byApp: [], byPayment: { cash: 0, mobile: 0, credit: 0, insurance: 0 }, itemsSold: 0 });
    const day = report("warehouse", {
      summary: empty,
      flows: [{ name: "Riz", unit: "sac", received: 10, sent: 4, sold: 0, adjusted: 0 }],
    });
    expect(day.totalLabel).toBe("Quantités entrées et sorties");
    expect(day.total).toBe("14");
    expect(day.sections.some((section) => section.heading === "Détail des paiements")).toBe(false);
    expect(labels(day)).toEqual(expect.arrayContaining(["Entré", "Sorti", "Riz"]));
  });

  it("says where the drawer stands, open or closed", () => {
    const session = { id: "1", openedAt: "2026-11-05T08:00:00Z", openingFloat: 500, cashSales: 8000, cashPayments: 0, cashIn: 0, cashOut: 0, byApp: [], expected: 8500, note: null, otherDevice: false };
    const open = report("shop", { cash: { ...session, closedAt: null, counted: null, difference: null } });
    expect(labels(open)).toEqual(expect.arrayContaining([screensFor("fr").openingFloat, screensFor("fr").expected]));
    const closed = report("shop", { cash: { ...session, closedAt: "2026-11-05T20:00:00Z", counted: 8400, difference: -100 } });
    expect(closed.sections.at(-1)?.rows).toHaveLength(3);
  });
});
