/*
 * What leaves a device is sealed before it leaves.
 *
 * The key comes from the shop's serial, which every device of the shop already
 * holds, so a phone activated with its serial joins with nothing else to do.
 * The website only ever sees the sealed bytes: it passes them along and deletes
 * them, and it has no field where they could be anything else.
 *
 * Web Crypto, so the same code runs in the desktop app and in a phone's browser.
 */

const ITERATIONS = 200_000; // not-a-rule: slows a guess at the key; about a quarter of a second, once per start
const VERSION = 1;
const IV_BYTES = 12; // not-a-rule: what AES-GCM expects

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function keyFor(serial: string, businessId: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(serial.replace(/[\s-]/g, "").toUpperCase()), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(`ouaqt-sync:${businessId}`), iterations: ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  const CHUNK = 0x8000; // not-a-rule: how many bytes String.fromCharCode takes at once
  for (let at = 0; at < bytes.length; at += CHUNK) text += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (letter) => letter.charCodeAt(0));
}

export async function seal(key: CryptoKey, message: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(message))));
  const whole = new Uint8Array(1 + IV_BYTES + sealed.length);
  whole[0] = VERSION;
  whole.set(iv, 1);
  whole.set(sealed, 1 + IV_BYTES);
  return toBase64(whole);
}

/** Null for anything that was not sealed with this key, or was changed on the way: it is ignored, not trusted. */
export async function unseal(key: CryptoKey, body: string): Promise<unknown | null> {
  try {
    const whole = fromBase64(body);
    if (whole[0] !== VERSION) return null;
    const opened = await crypto.subtle.decrypt({ name: "AES-GCM", iv: whole.slice(1, 1 + IV_BYTES) }, key, whole.slice(1 + IV_BYTES));
    return JSON.parse(decoder.decode(opened));
  } catch {
    return null;
  }
}
