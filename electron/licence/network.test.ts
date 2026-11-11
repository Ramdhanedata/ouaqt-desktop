import { describe, expect, it } from "vitest";
import { postWithVersion } from "./network";

/* A stand-in for the website: what it was sent, and what it answers. */
function website(answer: (body: Record<string, unknown>) => { status: number; json: unknown }) {
  const sent: Record<string, unknown>[] = [];
  const send = async (_path: string, body: unknown) => {
    sent.push(body as Record<string, unknown>);
    return answer(body as Record<string, unknown>);
  };
  return { sent, send };
}

describe("the app's version on a licence call", () => {
  it("goes up with the call", async () => {
    const site = website(() => ({ status: 200, json: { licence: "signed" } }));
    const answer = await postWithVersion("/api/licence/refresh", { deviceId: "a" }, "0.1.80", site.send);
    expect(answer.status).toBe(200);
    expect(site.sent).toEqual([{ deviceId: "a", appVersion: "0.1.80" }]);
  });

  it("is left out, once, by a website too old to know it", async () => {
    const site = website((body) =>
      "appVersion" in body ? { status: 400, json: { error: "invalid_request" } } : { status: 200, json: { licence: "signed" } }
    );
    const answer = await postWithVersion("/api/licence/activate", { serial: "RXVE7DV3" }, "0.1.80", site.send);
    expect(answer.status).toBe(200);
    expect(site.sent).toEqual([{ serial: "RXVE7DV3", appVersion: "0.1.80" }, { serial: "RXVE7DV3" }]);
  });

  it("does not hide any other refusal", async () => {
    const site = website(() => ({ status: 404, json: { error: "unknown_serial" } }));
    const answer = await postWithVersion("/api/licence/activate", { serial: "WRONG123" }, "0.1.80", site.send);
    expect(answer).toEqual({ status: 404, json: { error: "unknown_serial" } });
    expect(site.sent).toHaveLength(1);
  });

  it("is not sent when the app has none", async () => {
    const site = website(() => ({ status: 200, json: {} }));
    await postWithVersion("/api/licence/refresh", { deviceId: "a" }, undefined, site.send);
    expect(site.sent).toEqual([{ deviceId: "a" }]);
  });
});
