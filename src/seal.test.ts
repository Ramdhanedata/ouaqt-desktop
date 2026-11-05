import { describe, expect, it } from "vitest";
import { keyFor, seal, unseal } from "../electron/sync/seal";

describe("what leaves a device", () => {
  const message = { k: "rows", r: [{ t: "sales", i: "1", v: { total: 16000, name: "نقدا" } }] };

  it("opens on another device of the same shop, typed any way", async () => {
    const sealed = await seal(await keyFor("4EMXW6TN", "shop-1"), message);
    expect(await unseal(await keyFor("4emx-w6tn", "shop-1"), sealed)).toEqual(message);
  });

  it("says nothing readable on the way", async () => {
    const sealed = await seal(await keyFor("4EMXW6TN", "shop-1"), message);
    const bytes = atob(sealed);
    expect(bytes).not.toContain("sales");
    expect(bytes).not.toContain("16000");
  });

  it("is never the same twice, even for the same message", async () => {
    const key = await keyFor("4EMXW6TN", "shop-1");
    expect(await seal(key, message)).not.toBe(await seal(key, message));
  });

  it("opens for no other shop, even with the same serial", async () => {
    const sealed = await seal(await keyFor("4EMXW6TN", "shop-1"), message);
    expect(await unseal(await keyFor("AAAAAAAA", "shop-1"), sealed)).toBeNull();
    expect(await unseal(await keyFor("4EMXW6TN", "shop-2"), sealed)).toBeNull();
  });

  it("refuses anything changed on the way", async () => {
    const key = await keyFor("4EMXW6TN", "shop-1");
    const sealed = await seal(key, message);
    const flipped = (sealed[20] === "A" ? "B" : "A");
    expect(await unseal(key, sealed.slice(0, 20) + flipped + sealed.slice(21))).toBeNull();
    expect(await unseal(key, "not sealed at all")).toBeNull();
  });
});
