import type Database from "better-sqlite3";
import { insurancePayers, type InsurancePayer } from "@app-ui/config";
import { clampShare } from "@app-ui/money";
import { getSetting, setSetting } from "./rows";

/*
 * The share each health fund usually pays, as the manager keeps it.
 *
 * It is where the till starts when the cashier picks a fund; he can still
 * change it for one prescription. It lives here and not in the configuration
 * because it is the fund's rule of the year, not the owner's answer: when
 * CNAM changes its rate, the manager changes one number and nobody rebuilds
 * anything.
 *
 * Kept on this computer, like the printer. A fund with no share yet starts
 * the till at nothing, and the cashier types it.
 */

export type CoverShares = Partial<Record<InsurancePayer, number>>;

const key = (payer: InsurancePayer) => `cover_share_${payer}`;

export function coverShares(database: Database.Database): CoverShares {
  const shares: CoverShares = {};
  for (const payer of insurancePayers) {
    const value = getSetting(database, key(payer));
    if (value !== null && value.trim() !== "" && Number.isFinite(Number(value))) shares[payer] = clampShare(Number(value));
  }
  return shares;
}

export function setCoverShare(database: Database.Database, payer: string, share: number | null): void {
  if (!insurancePayers.includes(payer as InsurancePayer)) throw new Error("no such fund");
  if (share === null) {
    database.prepare("delete from settings_local where key = ?").run(key(payer as InsurancePayer));
    return;
  }
  if (!Number.isFinite(share)) throw new Error("a share is a number");
  setSetting(database, key(payer as InsurancePayer), String(clampShare(share)));
}
