/*
 * The time, never the same millisecond twice.
 *
 * A cash session counts the sales made from the moment it opens. A sale
 * recorded a moment before the opening, but in the same millisecond, was
 * counted in it: a fast computer does two things in one millisecond, and
 * the build machines caught it three times. Every moment this database
 * writes is now strictly after the one before, so "before" and "after"
 * always mean what they say.
 */
let last = 0;

export function clock(): Date {
  const now = Date.now();
  last = now > last ? now : last + 1;
  return new Date(last);
}
