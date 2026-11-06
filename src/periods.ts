/*
 * Days, weeks and months, as the shop lives them.
 *
 * Everything is in this device's own time zone: a sale at 23:30 belongs to
 * the evening it happened in. A week starts on Monday, the first working day
 * in Mauritania since the weekend moved to Saturday and Sunday. A month is
 * the calendar month.
 *
 * Pure arithmetic, shared by the reports screen and the database, so the
 * chart, the table and the figures above them cut the days at the same place.
 */

export type Unit = "day" | "week" | "month";
export type Period = { from: string; to: string };

/** Midnight at the start of the day that holds this moment. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The first moment of the day, week or month that holds this date. */
export function startOf(unit: Unit, date: Date): Date {
  const day = startOfDay(date);
  if (unit === "week") return new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7));
  if (unit === "month") return new Date(day.getFullYear(), day.getMonth(), 1);
  return day;
}

/** Moves a start of period by whole periods, back when steps is negative. */
export function shift(unit: Unit, start: Date, steps: number): Date {
  if (unit === "month") return new Date(start.getFullYear(), start.getMonth() + steps, 1);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + steps * (unit === "week" ? 7 : 1));
}

/** The day, week or month that holds this date, as the database's from and to. */
export function periodAt(unit: Unit, date: Date): Period {
  const start = startOf(unit, date);
  return { from: start.toISOString(), to: shift(unit, start, 1).toISOString() };
}

/** YYYY-MM-DD of a date, in this device's own time zone. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** A YYYY-MM-DD back into midnight of that day. Null when it is not a date. */
export function fromDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * What to read a period against: the one just before it. While the period
 * is still running, only as far into the one before as this one has got, so
 * a Tuesday afternoon is read against last Tuesday afternoon, not against a
 * whole week that has had its seven days.
 */
export function previousOf(unit: Unit, period: Period, now = new Date()): { period: Period; soFar: boolean } {
  const from = new Date(period.from);
  const to = new Date(period.to);
  const before = shift(unit, from, -1);
  const running = now.getTime() >= from.getTime() && now.getTime() < to.getTime();
  if (!running) return { period: { from: before.toISOString(), to: from.toISOString() }, soFar: false };
  /* The same point in the period before: the same time of day, so many days in. */
  const daysIn = Math.round((startOfDay(now).getTime() - from.getTime()) / 86_400_000); // not-a-rule: a day in milliseconds
  const sameDay = new Date(before.getFullYear(), before.getMonth(), before.getDate() + daysIn);
  const point = new Date(sameDay.getFullYear(), sameDay.getMonth(), sameDay.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
  const end = point.getTime() < from.getTime() ? point : from;
  return { period: { from: before.toISOString(), to: end.toISOString() }, soFar: true };
}

/** The change from one figure to the next, in whole percent; null when there was nothing before. */
export function changeOf(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100); // not-a-rule: a percent is a hundredth
}

/** The last so many days, weeks or months up to the one holding this date, oldest first. */
export function lastPeriods(unit: Unit, count: number, now = new Date()): { start: Date; period: Period }[] {
  const current = startOf(unit, now);
  const out: { start: Date; period: Period }[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const start = shift(unit, current, -index);
    out.push({ start, period: { from: start.toISOString(), to: shift(unit, start, 1).toISOString() } });
  }
  return out;
}
