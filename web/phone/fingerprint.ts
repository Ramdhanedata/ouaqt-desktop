import { existsSync, readFileSync, writeFileSync, SHOP_FOLDER, join } from "./disk";

/*
 * The phone, as activation describes a machine.
 *
 * A web page cannot read a motherboard or a disk serial, and should not. What
 * it can do is keep one random number of its own, made the first time the
 * app opens and stored with the shop. That number, salted and hashed the
 * way the desktop hashes its parts, is sent as the "machine" part; the other
 * two are null, which the server reads as "not reported" and never as a
 * match (see sameMachine in app-ui/licence-file.ts).
 *
 * It is weaker than a PC's fingerprint, honestly so: clearing the browser's
 * storage makes a new number. The trial is also held against the owner's
 * phone number and his business on the server, which is what stops a second
 * trial for the same shop.
 */

export type Fingerprint = { board: string | null; disk: string | null; machine: string | null };

const SALT = "ouaqt-phone-fingerprint-v1"; // not-a-rule: a label, not a limit
const FILE = join(SHOP_FOLDER, "phone-id");

function phoneId(): string {
  if (existsSync(FILE)) {
    const kept = String(readFileSync(FILE, "utf8")).trim();
    if (kept) return kept;
  }
  const made = globalThis.crypto.randomUUID();
  writeFileSync(FILE, made, "utf8");
  return made;
}

async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

let cached: Fingerprint | null = null;

export async function thisMachine(): Promise<Fingerprint> {
  if (!cached) cached = { board: null, disk: null, machine: await sha256(`${SALT}:${phoneId()}`) };
  return cached;
}
