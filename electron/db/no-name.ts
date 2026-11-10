/*
 * What the screens write for something saved with its name left empty, in
 * each language the app speaks. Kept here, apart from the rest of the words,
 * because sync must know them too: two nameless things made on two devices
 * are two things, not one.
 */
export const NO_NAME = { fr: "Sans nom", ar: "بدون اسم", en: "No name" } as const;

/** Empty, or only the stand-in a screen wrote for an empty name: nothing to recognise it by. */
export function isNameless(value: unknown): boolean {
  const text = typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value);
  return text === "" || (Object.values(NO_NAME) as string[]).includes(text);
}
