import { describe, expect, it } from "vitest";
import { change, lineTotal, sum, toMajor, toMinor } from "./money";

/*
 * The money path, checked the only way that matters: with the numbers that
 * break floats.
 */
describe("money is integers", () => {
  it("0.1 plus 0.2 is exactly 0.3", () => {
    expect(sum([toMinor(0.1), toMinor(0.2)])).toBe(toMinor(0.3));
    expect(toMajor(sum([toMinor(0.1), toMinor(0.2)]))).toBe(0.3);
  });

  it("stays exact over a thousand awkward prices", () => {
    const prices = Array.from({ length: 1000 }, (_, index) => toMinor(0.01 * (index + 1)));
    const total = sum(prices);
    expect(Number.isInteger(total)).toBe(true);
    /* 0.01 + 0.02 + ... + 10.00, which is 5005 ouguiyas exactly. */
    expect(total).toBe(toMinor(5005));
  });

  it("gives a line total as a whole number of minor units", () => {
    expect(lineTotal(3, toMinor(120.5))).toBe(toMinor(361.5));
    expect(Number.isInteger(lineTotal(0.25, toMinor(99.99)))).toBe(true);
  });

  it("never hands back negative change", () => {
    expect(change(toMinor(500), toMinor(640))).toBe(0);
    expect(change(toMinor(1000), toMinor(640))).toBe(toMinor(360));
  });

  it("round-trips a price without drift", () => {
    for (const price of [0.01, 0.99, 120.5, 12000, 99999.99]) {
      expect(toMajor(toMinor(price))).toBe(price);
    }
  });
});
