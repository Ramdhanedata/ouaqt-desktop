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
