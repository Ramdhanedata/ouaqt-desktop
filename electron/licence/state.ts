import type Database from "better-sqlite3";
import { coversDevice, verifyLicence } from "@app-ui/licence-file";
import { canStillWork, daysLeft, effectiveStatus, type LicenceStatus } from "@app-ui/licence-status";
import { LICENCE_PUBLIC_KEY } from "./keys";
import { noteTimeSeen, readLicence } from "./store";

/*
 * What the licence on this machine says, right now, with no network.
 *
 * A file that does not verify, or names another computer, is treated exactly
 * as no file: the owner is shown the serial screen. Not a warning, not a
 * retry, and never "carry on anyway".
 */

export type LicenceState =
  | { kind: "none" }
  | {
      kind: "ok";
      businessName: string;
      plan: string;
      status: LicenceStatus;
      clockWrong: boolean;
      canSell: boolean;
      daysLeft: number | null;
    };

export async function licenceState(
  folder: string,
  deviceId: string,
  now = new Date()
): Promise<LicenceState> {
  const signed = readLicence(folder);
  if (!signed) return { kind: "none" };

  const payload = await verifyLicence(signed, LICENCE_PUBLIC_KEY);
  if (!payload || !coversDevice(payload, deviceId)) return { kind: "none" };

  /* The latest time ever seen, which the clock rule is judged against. */
  const latestSeen = noteTimeSeen(folder, now);
  const licence = {
    plan: payload.plan,
    startsAt: payload.startsAt ? new Date(payload.startsAt) : null,
    endsAt: payload.endsAt ? new Date(payload.endsAt) : null,
    suspended: payload.status === "suspended",
  };

  const { status, clockWrong } = effectiveStatus(licence, now, latestSeen, {
    renewalGraceDays: payload.renewalGraceDays,
    clockGraceDays: payload.clockGraceDays,
  });

  return {
    kind: "ok",
    businessName: payload.businessName,
    plan: payload.plan,
    status,
    clockWrong,
    canSell: canStillWork(status),
    daysLeft: daysLeft(licence, clockWrong ? latestSeen : now),
  };
}

/** Whether a sale may be written right now. Read-only never hides anything. */
export async function maySell(folder: string, deviceId: string): Promise<boolean> {
  const state = await licenceState(folder, deviceId);
  return state.kind === "ok" && state.canSell;
}

export type { Database };
