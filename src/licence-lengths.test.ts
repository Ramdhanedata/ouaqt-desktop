import { describe, expect, it } from "vitest";
import type { LicenceState } from "./bridge";
import { ar, en, fr } from "./i18n";
import { lengthName, monthsPaid, pricedLengths } from "./licence-lengths";

type OkLicence = Extract<LicenceState, { kind: "ok" }>;

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-06T10:00:00Z");

const licence = (over: Partial<OkLicence>): OkLicence => ({
  kind: "ok",
  businessName: "Commerce",
  plan: "trial",
  status: "expired_trial",
  clockWrong: false,
  canSell: false,
  daysLeft: 0,
  startsAt: "2026-10-06T10:00:00Z",
  endsAt: "2026-11-05T10:00:00Z",
  graceUntil: null,
  trialSummaryDays: 5,
  ...over,
});

/* The website's own arithmetic: N months on by the calendar, from the later of now and the old end. */
function granted(from: number, months: number): string {
  const out = new Date(from);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out.toISOString();
}

const ended = licence({});
const paid = (endsAt: string) => licence({ plan: "annual", status: "active", canSell: true, endsAt });

describe("the lengths on the end window", () => {
  it("lists every length the website prices, longest first, whatever order they came in", () => {
    const lengths = pricedLengths([
      { plan: "monthly", amount: 130000 },
      { plan: "annual", amount: 1500000 },
      { plan: "bimonthly", amount: 260000 },
      { plan: "semiannual", amount: 750000 },
      { plan: "quarterly", amount: 450000 },
    ]);
    expect(lengths).toEqual([
      { months: 12, amount: 1500000 },
      { months: 6, amount: 750000 },
      { months: 3, amount: 450000 },
      { months: 2, amount: 260000 },
      { months: 1, amount: 130000 },
    ]);
  });

  it("leaves out a plan it does not know, and a length the website did not price", () => {
    expect(pricedLengths([{ plan: "perpetual", amount: 9500000 }, { plan: "monthly", amount: 130000 }])).toEqual([
      { months: 1, amount: 130000 },
    ]);
  });

  it("names each length in every language", () => {
    for (const copy of [fr, ar, en]) {
      const names = ([12, 6, 3, 2, 1] as const).map((months) => lengthName(copy, months));
      expect(new Set(names).size).toBe(5);
      for (const name of names) expect(name.trim()).not.toBe("");
    }
    expect(lengthName(fr, 1)).toBe("1 mois");
    expect(lengthName(en, 2)).toBe("2 months");
  });
});

describe("what a confirmed payment bought", () => {
  for (const months of [1, 2, 3, 6, 12] as const) {
    it(`tells ${months} month(s), seen at once`, () => {
      expect(monthsPaid(ended, paid(granted(NOW, months)), NOW)).toBe(months);
    });

    it(`tells ${months} month(s), seen five days after the payment`, () => {
      const paidAt = NOW - 5 * DAY;
      expect(monthsPaid(ended, paid(granted(paidAt, months)), NOW)).toBe(months);
    });

    it(`tells ${months} month(s) paid before the trial ended, from its end`, () => {
      const before = licence({ status: "trial", canSell: true, endsAt: new Date(NOW + 3 * DAY).toISOString() });
      expect(monthsPaid(before, paid(granted(NOW + 3 * DAY, months)), NOW)).toBe(months);
    });
  }

  it("tells a month that ends on a short month (31 January to 3 March)", () => {
    const now = Date.parse("2027-01-31T09:00:00Z");
    expect(monthsPaid(licence({ endsAt: "2027-01-30T09:00:00Z" }), paid(granted(now, 1)), now)).toBe(1);
  });

  it("names nothing it cannot tell apart: a gift of ten days, a change by hand of four months", () => {
    expect(monthsPaid(ended, paid(new Date(NOW + 10 * DAY).toISOString()), NOW)).toBeNull();
    expect(monthsPaid(ended, paid(granted(NOW, 4)), NOW)).toBeNull();
    expect(monthsPaid(ended, licence({ canSell: true, endsAt: null }), NOW)).toBeNull();
  });
});
