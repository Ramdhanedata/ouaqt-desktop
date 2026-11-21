/*
 * Whether this device may sell is asked before every write: each sale, each
 * line added to an order. Working the answer out reads the licence file,
 * checks its signature and writes the time seen to disk, so a yes is kept for
 * half a minute and the writes in between go straight through. A no is never
 * kept: once the shop is activated or renewed, the next write sees it at
 * once. A new licence clears the kept answer either way (writeLicence).
 */
const SELL_CHECK_MS = 30_000; // not-a-rule: how long a yes is trusted before it is worked out again

let lastYes: { key: string; at: number } | null = null;

const keyOf = (folder: string, deviceId: string) => `${folder}\u0000${deviceId}`;

export function keptYes(folder: string, deviceId: string, now = Date.now()): boolean {
  /* A clock moved back is no reason to keep trusting the last answer. */
  return lastYes !== null && lastYes.key === keyOf(folder, deviceId) && now >= lastYes.at && now - lastYes.at < SELL_CHECK_MS;
}

export function keepYes(folder: string, deviceId: string, may: boolean, now = Date.now()): void {
  lastYes = may ? { key: keyOf(folder, deviceId), at: now } : null;
}

export function forgetSellCheck(): void {
  lastYes = null;
}
