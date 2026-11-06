import type { LicenceState } from "./bridge";
import type { Copy } from "./i18n";

/*
 * The lengths a licence is paid for: a month, two, three, six or a year
 * (Adel, 2026-11-06), as the website names them, longest first, and how many
 * months each buys. What the words mean, not prices: the prices come from the
 * website with every check, and a length whose price is not set is not
 * offered.
 */
const LENGTHS = [
  { plan: "annual", months: 12 }, // not-a-rule: a year
  { plan: "semiannual", months: 6 }, // not-a-rule: half a year
  { plan: "quarterly", months: 3 }, // not-a-rule: a quarter
  { plan: "bimonthly", months: 2 }, // not-a-rule: two months
  { plan: "monthly", months: 1 }, // not-a-rule: a month
] as const;

export type Months = (typeof LENGTHS)[number]["months"];

type OkLicence = Extract<LicenceState, { kind: "ok" }>;

const MS_IN_A_DAY = 86_400_000;
const DAYS_IN_A_MONTH = 365.25 / 12; // not-a-rule: the calendar's average month
const ROOM_DAYS = 8; // not-a-rule: a late check's room, see monthsPaid

/* "3 mois", "سنة واحدة": a length as the owner says it. */
export function lengthName(copy: Copy, months: Months): string {
  if (months === 12) return copy.planYear;
  if (months === 6) return copy.planSixMonths;
  if (months === 3) return copy.planThreeMonths;
  if (months === 2) return copy.planTwoMonths;
  return copy.planMonth;
}

/* The prices the website sent, each with its length, longest first. A plan this build does not know is left out. */
export function pricedLengths(prices: { plan: string; amount: number }[]): { months: Months; amount: number }[] {
  return LENGTHS.flatMap(({ plan, months }) => {
    const price = prices.find((one) => one.plan === plan);
    return price ? [{ months, amount: price.amount }] : [];
  });
}

/*
 * What a confirmed payment bought, told from the licence before and after:
 * a month, two, three, six or twelve, or null when it is none of those.
 *
 * The time bought starts from today, or from the end he still had when he
 * paid early (as the website grants it), so the new end, less that start, is
 * about that many months. The room around each, a week and a day more per
 * month, is for a check that comes days after the payment, when the software
 * was closed; the lengths are far enough apart that no two rooms meet.
 * Anything else (a gift, a change by hand) is not named.
 */
export function monthsPaid(before: OkLicence, after: OkLicence, now = Date.now()): Months | null {
  if (!after.endsAt) return null;
  const from = Math.max(now, before.endsAt ? Date.parse(before.endsAt) : 0);
  const days = (Date.parse(after.endsAt) - from) / MS_IN_A_DAY;
  const found = LENGTHS.find(({ months }) => Math.abs(days - months * DAYS_IN_A_MONTH) <= ROOM_DAYS + months);
  return found?.months ?? null;
}
