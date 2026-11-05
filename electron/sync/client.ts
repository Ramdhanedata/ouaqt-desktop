import type Database from "better-sqlite3";
import { getSetting, setSetting } from "../db/rows";
import { applyChanges, markSent, nextChanges, queueEverything, startSharing, waitingToSend, type SyncRow } from "../db/sync";
import { apiOrigin } from "../licence/network";
import { keyFor, seal, unseal } from "./seal";

/*
 * A device talking to the shop's other devices.
 *
 * The shop never waits for this. A sale is written to this device first, as it
 * always was, and works with no internet at all. Whenever there is a
 * connection, what is waiting goes out and what the others did comes in. Cut
 * off for a week, a device catches up by itself when it is back.
 *
 * The other half of "the shop's trade stays on its devices": this is the one
 * place trade data leaves one, sealed (seal.ts), for the shop's own devices.
 */

export type SyncStatus = {
  state: "off" | "waiting" | "ok" | "offline" | "stopped";
  lastAt: string | null;
  pending: number;
};

export type SyncDeps = {
  database: () => Database.Database | null;
  deviceId: () => string;
  deviceToken: () => string | null;
  /** Another device's work has just been written: screens read again. */
  onChanged: () => void;
  /** After a change is written, for the phone, which must save its file. */
  afterWrite?: () => void;
};

const LOOK_EVERY_MS = 3_000; // not-a-rule: how soon a sale made here leaves
const LISTEN_BUSY_MS = 15_000; // not-a-rule: how soon the others' work appears while the shop is active
const LISTEN_QUIET_MS = 45_000; // not-a-rule: the same in a quiet moment, to spare phones and the server
const BUSY_FOR_MS = 300_000; // not-a-rule: what counts as an active shop
const MOST_BACKOFF_MS = 120_000; // not-a-rule: the longest wait between tries with no connection
const TIMEOUT_MS = 30_000; // not-a-rule: a slow connection, not a dead one
const MESSAGE_BYTES = 200_000; // not-a-rule: one sealed message, well under what the server takes in one call
const MESSAGES_A_CALL = 4; // not-a-rule: how many go up in one call

type Reply = { received: { id: number; body: string }[]; cursor: number; more: boolean; gap: boolean };

async function call(body: unknown): Promise<{ status: number; reply: Reply | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${apiOrigin()}/api/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: response.status, reply: response.ok ? ((await response.json()) as Reply) : null };
  } finally {
    clearTimeout(timer);
  }
}

export function startSync(deps: SyncDeps) {
  let inFlight: Promise<void> | null = null;
  let again = false;
  let state: SyncStatus["state"] = "waiting";
  let lastHeard = 0;
  let lastActive = 0;
  let backoff = 0;
  let key: { label: string; key: CryptoKey } | null = null;

  /* One exchange at a time. Asked during one, it runs once more straight after, and whoever asked waits for both. */
  function tick(): Promise<void> {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    const run: Promise<void> = exchange().finally(() => {
      inFlight = null;
      const more = again && !backoff;
      again = false;
      return more ? tick() : undefined;
    });
    inFlight = run;
    return run;
  }

  async function exchange(): Promise<void> {
    const database = deps.database();
    if (!database) return;
    const businessId = getSetting(database, "business_id");
    const serial = getSetting(database, "serial");
    const deviceToken = deps.deviceToken();
    if (!businessId || !serial || !deviceToken) {
      state = "waiting";
      return;
    }

    lastHeard = Date.now();
    try {
      const label = `${serial}:${businessId}`;
      if (key?.label !== label) key = { label, key: await keyFor(serial, businessId) };

      startSharing(database);

      /* What this device did, up to what fits in one call. Only forgotten once the server has it. */
      const send: string[] = [];
      const askAgain = getSetting(database, "sync_ask_again") === "1";
      if (askAgain) send.push(await seal(key.key, { k: "again" }));
      let upTo = 0;
      for (let count = 0; count < MESSAGES_A_CALL; count += 1) {
        const batch = nextChanges(database, MESSAGE_BYTES, upTo);
        upTo = batch.upTo || upTo;
        if (batch.rows.length === 0) break;
        send.push(await seal(key.key, { k: "rows", r: batch.rows }));
      }

      const after = Number(getSetting(database, "sync_cursor")) || 0;
      const { status, reply } = await call({ businessId, deviceId: deps.deviceId(), deviceToken, after, send });
      if (!reply) {
        /* This device was released, or its shop was: not a connection problem, and retrying fast will not help. */
        state = status === 404 || status === 403 ? "stopped" : "offline";
        backoff = Math.min(MOST_BACKOFF_MS, backoff ? backoff * 2 : LISTEN_BUSY_MS);
        return;
      }
      if (deps.database() !== database) return;

      if (upTo) markSent(database, upTo);
      if (askAgain) setSetting(database, "sync_ask_again", "0");
      if (send.length > 0) lastActive = Date.now();

      /* In the order the server took them, so what a row points at has come first where it can. */
      let changed = 0;
      for (const message of reply.received) {
        const opened = (await unseal(key.key, message.body)) as { k?: string; r?: SyncRow[] } | null;
        if (!opened) {
          console.error("a message from another device could not be opened");
          continue;
        }
        if (opened.k === "again") queueEverything(database);
        if (opened.k === "rows" && Array.isArray(opened.r)) changed += applyChanges(database, opened.r);
      }
      setSetting(database, "sync_cursor", String(reply.cursor));
      /* Away longer than the server keeps anything: the others send everything again. */
      if (reply.gap) setSetting(database, "sync_ask_again", "1");
      setSetting(database, "sync_last_at", new Date().toISOString());

      state = "ok";
      backoff = 0;
      if (reply.received.length > 0) lastActive = Date.now();
      if (changed > 0) {
        deps.afterWrite?.();
        deps.onChanged();
      }
      if (reply.more || waitingToSend(database) > 0 || reply.gap) again = true;
    } catch (error) {
      state = "offline";
      backoff = Math.min(MOST_BACKOFF_MS, backoff ? backoff * 2 : LISTEN_BUSY_MS);
      if (!(error instanceof TypeError) && (error as Error).name !== "AbortError") console.error("the devices could not exchange changes:", error);
    }
  }

  const timer = setInterval(() => {
    const database = deps.database();
    if (!database || inFlight) return;
    const now = Date.now();
    if (backoff) {
      if (now - lastHeard >= backoff) void tick();
      return;
    }
    const listen = now - lastActive < BUSY_FOR_MS ? LISTEN_BUSY_MS : LISTEN_QUIET_MS;
    if (now - lastHeard >= listen || (getSetting(database, "sync_ready") === "1" && waitingToSend(database) > 0)) void tick();
  }, LOOK_EVERY_MS);
  void tick();

  return {
    /** Back in front of the owner, or back online: no reason to wait for the next turn. */
    now: () => {
      backoff = 0;
      return tick();
    },
    status: (): SyncStatus => {
      const database = deps.database();
      if (!database) return { state: "off", lastAt: null, pending: 0 };
      return { state, lastAt: getSetting(database, "sync_last_at"), pending: waitingToSend(database) };
    },
    stop: () => clearInterval(timer),
  };
}
