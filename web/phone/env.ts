/*
 * The first thing the phone app runs, before any of the app's own modules is
 * read: the two things Node would have provided that the main-process code
 * reaches for.
 *
 * process.env, which the phone build points here (vite.phone.config.ts). Its
 * one value is which website to ask about the licence: the one this page came
 * from. The phone app is served by the website itself, so a preview of a
 * branch activates against that branch and the live site against itself.
 *
 * Whether this is a test copy, which decides the licence key it trusts. The
 * live site signs licences with the production key; a branch preview or a
 * local server signs with the test project's. The same files are served by
 * both, so it is decided here, by the address, rather than at build time the
 * way an installer's is.
 *
 * Buffer, as far as electron/licence/apply.ts uses it: made from the bytes a
 * logo download returns, read byte by byte, and written out as base64.
 */

class PhoneBuffer extends Uint8Array {
  toString(encoding?: string): string {
    if (encoding === "base64") {
      let binary = "";
      const step = 0x8000; // not-a-rule: a chunk size that String.fromCharCode accepts
      for (let index = 0; index < this.length; index += step) {
        binary += String.fromCharCode(...this.subarray(index, index + step));
      }
      return btoa(binary);
    }
    return new TextDecoder().decode(this);
  }
}

/* Node's Buffer.from, which Uint8Array.from's own signature does not let a subclass declare. */
function bufferFrom(value: ArrayBuffer | Uint8Array | string, encoding?: string): PhoneBuffer {
  if (typeof value === "string") {
    if (encoding === "base64") {
      const binary = atob(value);
      const bytes = new PhoneBuffer(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }
    const encoded = new TextEncoder().encode(value);
    const bytes = new PhoneBuffer(encoded.length);
    bytes.set(encoded);
    return bytes;
  }
  const source = value instanceof Uint8Array ? value : new Uint8Array(value);
  const bytes = new PhoneBuffer(source.length);
  bytes.set(source);
  return bytes;
}
Object.defineProperty(PhoneBuffer, "from", { value: bufferFrom });

const LIVE_HOSTS = ["www.ouaqt.com", "ouaqt.com", "ouaqtcom.vercel.app"];

const scope = globalThis as unknown as { __OUAQT_ENV__?: Record<string, string>; __OUAQT_TEST_BUILD__?: boolean; Buffer?: unknown };
scope.__OUAQT_ENV__ = { OUAQT_API_ORIGIN: window.location.origin };
scope.__OUAQT_TEST_BUILD__ = !LIVE_HOSTS.includes(window.location.hostname);
if (!scope.Buffer) scope.Buffer = PhoneBuffer;

export {};
