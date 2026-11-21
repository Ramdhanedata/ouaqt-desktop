import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { closeSession, dayStartedAt, ensureSession } from "./cash";
import { keepStatements, migrate, readMigrations } from "./open";
import { deviceIdOf } from "./rows";

function shop() {
  const db = keepStatements(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  migrate(db, readMigrations("electron/db/migrations"));
  return { db, device: deviceIdOf(db) };
}

const at = (hours: number, minutes = 0, day = 21) => new Date(2026, 10, day, hours, minutes);
const midnight = (day = 21) => new Date(2026, 10, day).toISOString();

describe("the working day", () => {
  it("starts at midnight while the day has not been closed", () => {
    const { db, device } = shop();
    ensureSession(db, device, at(8));
    expect(dayStartedAt(db, at(15))).toBe(midnight());
  });

  it("starts again at the closing, so the till counts from zero", () => {
    const { db, device } = shop();
    ensureSession(db, device, at(8));
    closeSession(db, device, { counted: 0 }, at(21, 30));
    expect(dayStartedAt(db, at(21, 31))).toBe(at(21, 30).toISOString());
    /* The drawer that opens next counts from the closing too. */
    expect(ensureSession(db, device, at(21, 40)).openedAt).toBe(at(21, 30).toISOString());
  });

  it("is back to midnight the next day, closed or not", () => {
    const { db, device } = shop();
    ensureSession(db, device, at(8));
    closeSession(db, device, { counted: 0 }, at(21, 30));
    expect(dayStartedAt(db, at(9, 0, 22))).toBe(midnight(22));
  });

  it("ignores a closing dated after now, as with a clock set back", () => {
    const { db, device } = shop();
    ensureSession(db, device, at(8));
    closeSession(db, device, { counted: 0 }, at(21, 30));
    expect(dayStartedAt(db, at(20))).toBe(midnight());
  });
});
