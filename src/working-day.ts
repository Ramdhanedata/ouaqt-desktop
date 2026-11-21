import { machine, type Period } from "./bridge";
import { periodOf } from "./screens/reports";

/*
 * The day the till is counting: from midnight, or from the moment the day
 * was closed (end of day, or the drawer counted in Caisse), until midnight.
 * The figures at the top of the till, the end-of-day report and the list of
 * today's sales all read this one, so after closing they all start again at
 * zero together. If the question fails, the calendar day is the answer.
 */
export async function workingDay(): Promise<Period> {
  const today = periodOf("today");
  const answer = await machine.cashDayStart().catch(() => null);
  return answer?.ok && answer.value > today.from && answer.value < today.to ? { from: answer.value, to: today.to } : today;
}
