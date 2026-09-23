import type { Fingerprint } from "./fingerprint";

/*
 * The only file in this app that talks to the network.
 *
 * Two calls, both to our own licence API, both documented in
 * vendor/ouaqt-website/docs/LICENCE_API.md. Neither carries a sale, a stock
 * movement, a debt, a customer or a product the shop has changed: the request
 * bodies below are the whole of what leaves this machine, and they are short
 * enough to read.
 *
 * Keeping it to one file is the point. "No code path sends business data
 * anywhere" is something anybody can check by reading this, rather than
 * something we have to be trusted about.
 */

/*
 * Which website to ask. Baked in at build time for an installer, overridable
 * for a test against a local server.
 */
declare const __OUAQT_API_ORIGIN__: string;

export function apiOrigin(): string {
  const fromEnvironment = process.env.OUAQT_API_ORIGIN;
  if (fromEnvironment) return fromEnvironment.replace(/\/$/, "");
  return typeof __OUAQT_API_ORIGIN__ === "string" ? __OUAQT_API_ORIGIN__ : "https://ouaqtcom.vercel.app";
}

export type ActivationAnswer =
  | {
      ok: true;
      licence: string;
      deviceToken: string;
      configuration: unknown;
      configurationVersion: number | null;
      products: unknown[];
      staff: { name: string; role: string }[];
      logo: { colour: string; mono: string } | null;
    }
  | {
      ok: false;
      error: string;
      because?: string;
      supportWhatsapp?: string;
      maxDevices?: number;
    };

/*
 * The way in is either a serial the owner typed, or a one-time token that
 * arrived through the ouaqt:// link. Never both, and the token is never
 * written anywhere: it is passed straight in here and spent.
 */
export type Proof = { serial: string } | { token: string };

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${apiOrigin()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

export async function activate(input: {
  proof: Proof;
  deviceId: string;
  deviceName?: string;
  platform: "windows" | "mac";
  fingerprint: Fingerprint;
  /* The shop this machine's database already belongs to, if it has one. */
  expectBusinessId?: string;
}): Promise<ActivationAnswer> {
  try {
    const { status, json } = await post("/api/licence/activate", {
      ...input.proof,
      deviceId: input.deviceId,
      ...(input.deviceName ? { deviceName: input.deviceName } : {}),
      platform: input.platform,
      fingerprint: input.fingerprint,
      ...(input.expectBusinessId ? { expectBusinessId: input.expectBusinessId } : {}),
    });

    const body = (json ?? {}) as Record<string, unknown>;
    if (status === 200 && typeof body.licence === "string" && typeof body.deviceToken === "string") {
      return {
        ok: true,
        licence: body.licence,
        deviceToken: body.deviceToken,
        configuration: body.configuration ?? null,
        configurationVersion: (body.configurationVersion as number | null) ?? null,
        products: Array.isArray(body.products) ? body.products : [],
        staff: Array.isArray(body.staff) ? (body.staff as { name: string; role: string }[]) : [],
        logo: (body.logo as { colour: string; mono: string } | null) ?? null,
      };
    }

    return {
      ok: false,
      error: typeof body.error === "string" ? body.error : `status_${status}`,
      because: typeof body.because === "string" ? body.because : undefined,
      supportWhatsapp: typeof body.supportWhatsapp === "string" ? body.supportWhatsapp : undefined,
      maxDevices: typeof body.maxDevices === "number" ? body.maxDevices : undefined,
    };
  } catch {
    return { ok: false, error: "no_network" };
  }
}

/* The logo, fetched from the short-lived link activation handed over. */
export async function download(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}
