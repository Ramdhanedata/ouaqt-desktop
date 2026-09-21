/*
 * Money, as integers.
 *
 * Every amount in this app is a whole number of the smallest unit: 1 MRU is
 * 100. Nothing is ever a float, because 0.1 + 0.2 is not 0.3 and a till that
 * is out by a hundredth every day is out by a lot by December.
 *
 * The shared formatter in app-ui currently takes amounts in whole ouguiyas,
 * the way the website stores prices. That is a real difference between the
 * two sides and it is resolved in one place, here, until the website moves
 * to minor units as well. It is in docs/ASSUMPTIONS.md.
 */

const MINOR_PER_MAJOR = 100; // not-a-rule: 1 MRU is 100 of its smallest unit

export type Minor = number;

export function toMinor(major: number): Minor {
  return Math.round(major * MINOR_PER_MAJOR);
}

export function toMajor(minor: Minor): number {
  return minor / MINOR_PER_MAJOR;
}

/** Adds without ever leaving integers. */
export function sum(amounts: Minor[]): Minor {
  return amounts.reduce((total, amount) => total + amount, 0);
}

/** A line total: a quantity that may be fractional, an integer price. */
export function lineTotal(quantity: number, unitPrice: Minor): Minor {
  return Math.round(quantity * unitPrice);
}

/** What to hand back, never negative. */
export function change(given: Minor, due: Minor): Minor {
  return Math.max(0, given - due);
}
