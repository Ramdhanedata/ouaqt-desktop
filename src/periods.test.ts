import { describe, expect, it } from "vitest";
import { changeOf, dayKey, fromDayKey, lastPeriods, periodAt, previousOf, shift, startOf } from "./periods";

/*
 * The days, weeks and months the reports cut, in this device's own time.
 */
describe("periods", () => {
  /* Friday 6 November 2026, mid-afternoon. */
  const friday = new Date(2026, 10, 6, 15, 30);

  it("starts a week on Monday and a month on the first", () => {
    expect(dayKey(startOf("week", friday))).toBe("2026-11-02");
    expect(dayKey(startOf("week", new Date(2026, 10, 8, 23)))).toBe("2026-11-02");
    expect(dayKey(startOf("week", new Date(2026, 10, 9, 0, 1)))).toBe("2026-11-09");
    expect(dayKey(startOf("month", friday))).toBe("2026-11-01");
    expect(dayKey(startOf("day", friday))).toBe("2026-11-06");
  });

  it("gives a period from its first moment to the next one's", () => {
    const week = periodAt("week", friday);
    expect(week.from).toBe(new Date(2026, 10, 2).toISOString());
    expect(week.to).toBe(new Date(2026, 10, 9).toISOString());
    const month = periodAt("month", new Date(2026, 11, 31));
    expect(month.to).toBe(new Date(2027, 0, 1).toISOString());
  });

  it("steps whole periods back and forth, across a year", () => {
    expect(dayKey(shift("month", new Date(2026, 0, 1), -1))).toBe("2025-12-01");
    expect(dayKey(shift("week", new Date(2026, 10, 2), -1))).toBe("2026-10-26");
    expect(dayKey(shift("day", new Date(2026, 2, 1), -1))).toBe("2026-02-28");
  });

  it("reads a running period against the same point in the one before", () => {
    const today = previousOf("day", periodAt("day", friday), friday);
    expect(today.soFar).toBe(true);
    expect(today.period.from).toBe(new Date(2026, 10, 5).toISOString());
    expect(today.period.to).toBe(new Date(2026, 10, 5, 15, 30).toISOString());

    const month = previousOf("month", periodAt("month", friday), friday);
    expect(month.period.from).toBe(new Date(2026, 9, 1).toISOString());
    expect(month.period.to).toBe(new Date(2026, 9, 6, 15, 30).toISOString());
  });

  it("reads a finished period against the whole one before", () => {
    const lastWeek = previousOf("week", periodAt("week", new Date(2026, 9, 28)), friday);
    expect(lastWeek.soFar).toBe(false);
    expect(lastWeek.period.from).toBe(new Date(2026, 9, 19).toISOString());
    expect(lastWeek.period.to).toBe(new Date(2026, 9, 26).toISOString());
  });

  it("never reaches past the period's own start, even from a long month to a short one", () => {
    const march31 = new Date(2026, 2, 31, 12);
    const before = previousOf("month", periodAt("month", march31), march31);
    expect(before.period.from).toBe(new Date(2026, 1, 1).toISOString());
    expect(before.period.to).toBe(new Date(2026, 2, 1).toISOString());
  });

  it("lists the last periods oldest first, ending with the current one", () => {
    const months = lastPeriods("month", 12, friday);
    expect(months).toHaveLength(12);
    expect(dayKey(months[0].start)).toBe("2025-12-01");
    expect(dayKey(months[11].start)).toBe("2026-11-01");
    expect(months[10].period.to).toBe(months[11].period.from);
  });

  it("says a change in whole percent, and nothing when there was nothing before", () => {
    expect(changeOf(1200, 1000)).toBe(20);
    expect(changeOf(800, 1000)).toBe(-20);
    expect(changeOf(500, 0)).toBeNull();
  });

  it("reads back a typed day, and refuses what is not one", () => {
    expect(dayKey(fromDayKey("2026-11-06") as Date)).toBe("2026-11-06");
    expect(fromDayKey("06/11/2026")).toBeNull();
    expect(fromDayKey("")).toBeNull();
  });
});
