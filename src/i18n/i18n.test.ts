import { describe, expect, it } from "vitest";
import { ar, en, fr } from "./index";

/*
 * A missing word fails the build rather than appearing as a blank on a
 * counter in front of a customer.
 */
describe("the app's own words", () => {
  const languages = { fr, ar, en };

  it.each(Object.keys(languages))("%s has every key French has", (name) => {
    const copy = languages[name as keyof typeof languages];
    expect(Object.keys(copy).sort()).toEqual(Object.keys(fr).sort());
  });

  it.each(Object.keys(languages))("%s has no empty word", (name) => {
    const copy = languages[name as keyof typeof languages];
    for (const [key, value] of Object.entries(copy)) {
      expect(value.trim(), key).not.toBe("");
    }
  });
});

describe("counting the days left, the way each language does", () => {
  it("writes thirty days as Arabic writes them", async () => {
    const { ar, daysLeftLine } = await import("./index");
    expect(daysLeftLine(ar, "ar", 30)).toBe("التجربة المجانية: بقي 30 يوما");
    expect(daysLeftLine(ar, "ar", 5)).toBe("التجربة المجانية: بقيت 5 أيام");
    expect(daysLeftLine(ar, "ar", 2)).toBe("التجربة المجانية: بقي يومان");
    expect(daysLeftLine(ar, "ar", 1)).toBe("التجربة المجانية: بقي يوم واحد");
  });

  it("keeps French to its two forms", async () => {
    const { fr, daysLeftLine } = await import("./index");
    expect(daysLeftLine(fr, "fr", 1)).toBe("Essai gratuit : 1 jour restant");
    expect(daysLeftLine(fr, "fr", 30)).toBe("Essai gratuit : 30 jours restants");
  });
});
