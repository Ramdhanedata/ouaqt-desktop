import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Where the licence lives on this machine, beside the database.
 *
 * Three small files. The signed licence, which anybody may read because only
 * we can make one. The device token, which proves at refresh that this is the
 * machine that activated, and is written readable by this user only. And the
 * latest time the app has ever seen, which is what the clock rule is judged
 * against.
 */

export type LicenceFiles = { folder: string };

const LICENCE = "licence.txt";
const TOKEN = "device-token";
const SEEN = "latest-seen.txt";

function read(folder: string, name: string): string | null {
  const file = join(folder, name);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function readLicence(folder: string): string | null {
  return read(folder, LICENCE);
}

export function writeLicence(folder: string, signed: string): void {
  writeFileSync(join(folder, LICENCE), signed, "utf8");
}

export function readDeviceToken(folder: string): string | null {
  return read(folder, TOKEN);
}

export function writeDeviceToken(folder: string, token: string): void {
  const file = join(folder, TOKEN);
  writeFileSync(file, token, { encoding: "utf8", mode: 0o600 });
  /* Where the system allows it: this user, and nobody else on the machine. */
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows keeps its own permissions; the file is in the user's profile. */
  }
}

/**
 * Record now as seen, and return the latest time ever seen. The clock can go
 * backwards; this never does.
 */
export function noteTimeSeen(folder: string, now: Date): Date {
  const previous = read(folder, SEEN);
  const before = previous ? new Date(previous) : null;
  const latest = before && !Number.isNaN(before.getTime()) && before > now ? before : now;
  writeFileSync(join(folder, SEEN), latest.toISOString(), "utf8");
  return latest;
}
