/*
 * Two whole devices of one shop, over a real connection that goes away.
 *
 * The real client, the real sealing and the website's real post box rules, with
 * only the post box's database swapped for memory. Each device has its own
 * database file. check-db.mjs proves the merging row by row; this proves the
 * whole trip, including a day with no internet.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const folder = mkdtempSync(join(tmpdir(), "ouaqt-sync-"));
await build({
  entryPoints: { client: "electron/sync/client.ts", relay: "vendor/ouaqt-website/builder/sync/relay.ts" },
  outdir: folder,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["better-sqlite3", "electron"],
  logLevel: "error",
});
const { startSync } = require(join(folder, "client.js"));
const { relay, syncRequest } = require(join(folder, "relay.js"));
const shop = require(join(process.cwd(), "dist/main/db.js"));

let failures = 0;
const check = (what, passed, detail = "") => {
  if (!passed) failures += 1;
  console.log(`  ${passed ? "pass" : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
  if (!passed && process.env.GITHUB_ACTIONS) console.log(`::error title=check-sync::${what}${detail ? `: ${detail}` : ""}`);
};

/* ── The post box ──────────────────────────────────────────────────── */

const BUSINESS = "7c0cefa7-d1ca-44cf-b511-e6c01fc50aef";
const hash = (token) => createHash("sha256").update(token).digest("hex");
const devices = [];
let messages = [];
let nextId = 0;
const everySealed = [];
const store = {
  devices: async () => devices,
  waiting: async () => messages.length,
  add: async (_shop, from_device, bodies) => {
    for (const body of bodies) {
      messages.push({ id: (nextId += 1), from_device, body, at: new Date() });
      everySealed.push(body);
    }
  },
  next: async (_shop, notFrom, after, limit) => messages.filter((one) => one.from_device !== notFrom && one.id > after).slice(0, limit),
  markRead: async (_shop, deviceId, cursor, at) => {
    const one = devices.find((device) => device.device_id === deviceId);
    one.sync_cursor = cursor;
    one.sync_seen_at = at.toISOString();
  },
  forget: async (_shop, from, upTo) => {
    messages = messages.filter((one) => !(one.from_device === from && one.id <= upTo));
  },
  forgetOlderThan: async (_shop, before) => {
    messages = messages.filter((one) => one.at >= before);
  },
};
const answer = async (request, response) => {
  let text = "";
  for await (const part of request) text += part;
  const input = syncRequest.safeParse(JSON.parse(text));
  const reply = input.success ? await relay(store, input.data, hash(input.data.deviceToken)) : { ok: false, status: 400, error: "invalid" };
  response.writeHead(reply.ok ? 200 : reply.status, { "content-type": "application/json" });
  response.end(JSON.stringify(reply));
};
let server = createServer(answer);
const listen = (port) => new Promise((done) => server.listen(port, "127.0.0.1", () => done(server.address().port)));
const port = await listen(0);
process.env.OUAQT_API_ORIGIN = `http://127.0.0.1:${port}`;
const cutTheLine = () => new Promise((done) => {
  server.closeAllConnections();
  server.close(done);
});
const bringItBack = async () => {
  server = createServer(answer);
  await listen(port);
};

/* ── The devices ───────────────────────────────────────────────────── */

const migrations = readdirSync("electron/db/migrations").filter((name) => name.endsWith(".sql")).sort();
function makeDevice(name, serial = "4EMXW6TN") {
  const db = new Database(join(folder, `${name}.db`));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec("create table if not exists schema_migrations (name text primary key, applied_at text not null)");
  for (const file of migrations) {
    db.transaction(() => {
      db.exec(readFileSync(join("electron/db/migrations", file), "utf8"));
      db.prepare("insert into schema_migrations (name, applied_at) values (?, ?)").run(file, new Date().toISOString());
    })();
  }
  const id = shop.deviceIdOf(db);
  shop.watchChanges(db);
  shop.setSetting(db, "business_id", BUSINESS);
  shop.setSetting(db, "serial", serial);
  const token = `token-${name}-${"x".repeat(30)}`;
  devices.push({ device_id: id, status: "active", token_hash: hash(token), sync_cursor: 0, sync_seen_at: null });
  const device = { db, id, name, changed: 0 };
  device.sync = startSync({
    database: () => db,
    deviceId: () => id,
    deviceToken: () => token,
    onChanged: () => {
      device.changed += 1;
    },
  });
  return device;
}

/* Turn after turn until nothing moves, as the timers would, faster. */
async function settle(...all) {
  for (let turn = 0; turn < 12; turn += 1) {
    for (const device of all) await device.sync.now();
  }
}
const day = { from: "2000-01-01T00:00:00.000Z", to: "2100-01-01T00:00:00.000Z" };
const sell = (one, productId, quantity, unitPrice) => shop.recordSale(one.db, one.id, { lines: [{ productId, quantity, unitPrice }], payment: "cash" });
const count = (one, table) => one.db.prepare(`select count(*) as n from ${table}`).get().n;

console.log("\nTwo devices over a connection that goes away\n");

const pc = makeDevice("pc");
const phone = makeDevice("phone");

const riceOnPc = shop.addProduct(pc.db, pc.id, { name: "Riz 5 kg", salePrice: 30000 });
shop.recordMovement(pc.db, pc.id, { productId: riceOnPc, quantity: 50, reason: "reception", reference: "activation" });
const riceOnPhone = shop.addProduct(phone.db, phone.id, { name: "Riz 5 kg", salePrice: 30000 });
shop.recordMovement(phone.db, phone.id, { productId: riceOnPhone, quantity: 50, reason: "reception", reference: "activation" });
await settle(pc, phone);
check("activated apart, they become one shop", count(pc, "products") === 1 && count(phone, "products") === 1 && shop.onHand(phone.db, riceOnPhone) === 50, `${count(pc, "products")} ${count(phone, "products")} ${shop.onHand(phone.db, riceOnPhone)}`);
check("both say they are up to date", pc.sync.status().state === "ok" && phone.sync.status().state === "ok" && pc.sync.status().pending === 0, JSON.stringify(pc.sync.status()));

const firstSale = sell(pc, riceOnPc, 2, 30000);
const changedBefore = phone.changed;
await settle(pc, phone);
check("a sale on the computer reaches the phone", shop.saleDetail(phone.db, firstSale.id)?.total === 60000);
check("and the phone's screens are told", phone.changed > changedBefore);
check("and the phone's stock follows", shop.onHand(phone.db, riceOnPhone) === 48);

const fromPhone = sell(phone, riceOnPhone, 1, 30000);
await settle(pc, phone);
check("a sale on the phone reaches the computer", shop.saleDetail(pc.db, fromPhone.id)?.total === 30000);

/* The internet goes. */
await cutTheLine();
const apart = [sell(pc, riceOnPc, 3, 30000), sell(pc, riceOnPc, 1, 30000), sell(phone, riceOnPhone, 4, 30000)];
check("with no internet both still sell", apart.every(Boolean));
await settle(pc, phone);
check("and say so", pc.sync.status().state === "offline" && phone.sync.status().state === "offline", pc.sync.status().state);
check("with their changes kept to send", pc.sync.status().pending > 0 && phone.sync.status().pending > 0, `${pc.sync.status().pending} ${phone.sync.status().pending}`);
check("neither has the other's sale yet", shop.saleDetail(phone.db, apart[0].id) === null && shop.saleDetail(pc.db, apart[2].id) === null);

/* It comes back. */
await bringItBack();
await settle(pc, phone);
const net = shop.summary(pc.db, day).net;
check("when it returns, every sale is on both", shop.saleDetail(phone.db, apart[0].id)?.total === 90000 && shop.saleDetail(pc.db, apart[2].id)?.total === 120000);
check("the takings agree, none lost or doubled", net === shop.summary(phone.db, day).net && net === 30000 * (2 + 1 + 3 + 1 + 4), `${net} ${shop.summary(phone.db, day).net}`);
check("and so does the stock", shop.onHand(pc.db, riceOnPc) === 39 && shop.onHand(phone.db, riceOnPhone) === 39, `${shop.onHand(pc.db, riceOnPc)} ${shop.onHand(phone.db, riceOnPhone)}`);
check("nothing is left to send", pc.sync.status().pending === 0 && phone.sync.status().pending === 0);

/* What the server saw. */
await settle(pc, phone);
check("the post box forgets what has been delivered", messages.length === 0, `${messages.length} left`);
const onTheWire = everySealed.map((body) => Buffer.from(body, "base64").toString("latin1")).join("");
check("it never saw a name or a figure", everySealed.length > 0 && !onTheWire.includes("Riz") && !onTheWire.includes("stock_movements") && !onTheWire.includes("sale_price"), `${everySealed.length} messages`);

/* A stranger with a real token and the wrong serial reads nothing, and breaks nothing. */
const stranger = makeDevice("stranger", "AAAAAAAA");
const salesBefore = count(pc, "sales");
const errors = console.error;
console.error = () => undefined;
sell(pc, riceOnPc, 1, 30000);
await settle(pc, phone, stranger);
console.error = errors;
check("sealed for another serial, nothing can be read", count(stranger, "sales") === 0, `${count(stranger, "sales")} sales`);
check("and the shop carries on", count(phone, "sales") === salesBefore + 1);
stranger.sync.stop();
devices.splice(devices.findIndex((one) => one.device_id === stranger.id), 1);
stranger.db.close();
await settle(pc, phone);

/* A device added later receives the shop as it is. */
const added = makeDevice("added");
await settle(pc, phone, added);
check("a device added later receives everything", count(added, "sales") === count(pc, "sales") && shop.summary(added.db, day).net === shop.summary(pc.db, day).net, `${count(added, "sales")} of ${count(pc, "sales")}`);
const riceThere = shop.listProducts(added.db).filter((one) => one.name === "Riz 5 kg");
check("with one product and the same stock", riceThere.length === 1 && riceThere[0].onHand === shop.onHand(phone.db, riceOnPhone), `${riceThere.length} products, ${riceThere[0]?.onHand} and ${shop.onHand(phone.db, riceOnPhone)}`);

/* A device the owner has released stops, and says why. */
devices.find((one) => one.device_id === added.id).status = "released";
await settle(added);
check("a released device stops, and says so", added.sync.status().state === "stopped", added.sync.status().state);

for (const device of [pc, phone, added]) {
  device.sync.stop();
  device.db.close();
}
await new Promise((done) => server.close(done));
rmSync(folder, { recursive: true, force: true });

console.log(failures === 0 ? "\nThe devices hold together.\n" : `\n${failures} checks failed.\n`);
process.exit(failures === 0 ? 0 : 1);
