import type { Fingerprint } from "./fingerprint";

/*
 * The only file in this app that talks to the network about the shop.
 * (updates.ts also reaches the network, to fetch new versions, and sends
 * nothing at all.)
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
      serial: string | null;
      deviceToken: string;
      configuration: unknown;
      configurationVersion: number | null;
      products: unknown[];
      staff: { name: string; role: string }[];
      logo: { colour: string; mono: string } | null;
      /* OUAQT's WhatsApp, for the "contact OUAQT" button when the trial ends. */
      supportWhatsapp: string | null;
    }
  | {
      ok: false;
      error: string;
      because?: string;
      supportWhatsapp?: string;
      maxDevices?: number;
    };

/*
 * The way in: the software asking, on its first start, whether it was
 * downloaded from the connection it stands on (the website answers from the
 * connection alone, nothing about this machine is sent for it); a serial the
 * owner typed; or a one-time token that arrived through the ouaqt:// link.
 * Only one at a time, and the token is never written anywhere: it is passed
 * straight in here and spent.
 */
export type Proof = { nearby: true } | { serial: string } | { token: string };

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
        serial: typeof body.serial === "string" ? body.serial : null,
        deviceToken: body.deviceToken,
        configuration: body.configuration ?? null,
        configurationVersion: (body.configurationVersion as number | null) ?? null,
        products: Array.isArray(body.products) ? body.products : [],
        staff: Array.isArray(body.staff) ? (body.staff as { name: string; role: string }[]) : [],
        logo: (body.logo as { colour: string; mono: string } | null) ?? null,
        supportWhatsapp: typeof body.supportWhatsapp === "string" ? body.supportWhatsapp : null,
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

/*
 * Asking the website whether anything changed: a renewal paid for, a
 * suspension, or a new configuration because the owner finished the
 * questions again. Only who is asking and which configuration it holds go
 * up; nothing about the shop's sales ever does.
 */
export type RefreshAnswer =
  | {
      ok: true;
      licence: string;
      /* The shop's own numéro de série, shown to the owner when the trial ends. */
      serial: string | null;
      configurationVersion: number | null;
      /* Null when the one this computer holds is still the newest. */
      configuration: unknown | null;
      logo: { colour: string; mono: string } | null;
      /* His staff as he last wrote it on the website, sent with a new configuration. */
      staff: { name: string; role: string }[] | null;
      supportWhatsapp: string | null;
    }
  | { ok: false; error: string };

export async function refresh(input: {
  businessId: string;
  deviceId: string;
  deviceToken: string;
  configurationVersion?: number;
}): Promise<RefreshAnswer> {
  try {
    const { status, json } = await post("/api/licence/refresh", input);
    const body = (json ?? {}) as Record<string, unknown>;
    if (status === 200 && typeof body.licence === "string") {
      return {
        ok: true,
        licence: body.licence,
        serial: typeof body.serial === "string" ? body.serial : null,
        configurationVersion: typeof body.configurationVersion === "number" ? body.configurationVersion : null,
        configuration: body.configuration ?? null,
        logo: (body.logo as { colour: string; mono: string } | null) ?? null,
        staff: Array.isArray(body.staff) ? (body.staff as { name: string; role: string }[]) : null,
        supportWhatsapp: typeof body.supportWhatsapp === "string" ? body.supportWhatsapp : null,
      };
    }
    return { ok: false, error: typeof body.error === "string" ? body.error : `status_${status}` };
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
