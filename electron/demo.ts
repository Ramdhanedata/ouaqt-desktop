import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { BrowserWindow } from "electron";
import { sampleProducts } from "@app-ui/sample-data";
import type { Pack } from "@app-ui/packs";
import { addProduct, listProducts, recordMovement } from "./db/products";

/*
 * Demo mode: the till with invented products, for screenshots and for walking
 * through it without a serial.
 *
 * Switched on by OUAQT_DEMO=1, which no installer sets. It runs in its own
 * data folder, beside the real one and never inside it, so a demo can never
 * write an invented product into a shop's actual database. That separation
 * is the whole safety of this file.
 */

export const DEMO = process.env.OUAQT_DEMO === "1";

/** The folder demo mode uses instead of the real one. */
export function demoFolder(real: string): string {
  return join(real, "..", "OUAQT Demo");
}

/* The configuration the demo runs, copied in from the fixtures. */
export function prepareDemoFolder(folder: string, fixture: string): void {
  mkdirSync(folder, { recursive: true });
  copyFileSync(fixture, join(folder, "configuration.json"));
}

/*
 * The invented products for this trade, from the same sample list the
 * builder's preview draws. Only when the demo database is empty, so running
 * the demo twice does not double the stock.
 */
export function seedDemo(database: Database.Database, deviceId: string, pack: Pack): void {
  if (listProducts(database).length > 0) return;

  for (const sample of sampleProducts(pack)) {
    const id = addProduct(database, deviceId, {
      name: sample.name.fr,
      nameArabic: sample.name.ar,
      salePrice: sample.price,
    });
    recordMovement(database, deviceId, {
      productId: id,
      quantity: sample.inStock,
      reason: "reception",
    });
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function shoot(window: BrowserWindow, file: string): Promise<void> {
  const image = await window.webContents.capturePage();
  writeFileSync(file, image.toPNG());
}

/* Press the button whose text is exactly this, the way a cashier would. */
function press(window: BrowserWindow, text: string, nth = 0): Promise<boolean> {
  return window.webContents.executeJavaScript(`(() => {
    const wanted = ${JSON.stringify(text)};
    const buttons = [...document.querySelectorAll("button")]
      .filter((b) => (b.innerText || "").split("\\n")[0].trim() === wanted);
    const target = buttons[${nth}];
    if (!target || target.disabled) return false;
    target.click();
    return true;
  })()`);
}

/*
 * Walk the till: two of one product, one of another, charge, and a picture at
 * each step. The result is a sale in the demo database and three PNGs, which
 * is proof the screen does what the checks say the database does.
 */
export async function walkTill(
  window: BrowserWindow,
  database: Database.Database,
  out: string,
  charge: string
): Promise<void> {
  mkdirSync(out, { recursive: true });
  await pause(1500);
  await shoot(window, join(out, "1-empty.png"));

  const products = listProducts(database);
  const first = products[0];
  const second = products[1];
  const language = process.env.OUAQT_DEMO_LANG === "ar" ? "ar" : "fr";
  const label = (p: typeof first) => (language === "ar" ? p.nameArabic || p.name : p.name);

  const steps = {
    firstTwice: (await press(window, label(first))) && (await press(window, label(first))),
    second: await press(window, label(second)),
  };
  await pause(500);
  await shoot(window, join(out, "2-ticket.png"));

  /*
   * The ticket, read off the screen before charging. The walk pressed the
   * first product twice and the second once, so anything else here came
   * from somewhere that is not the walk.
   */
  const ticket = (await window.webContents.executeJavaScript(`(() =>
    [...document.querySelectorAll("aside li")].map((li) => li.innerText.split("\\n")[0].trim())
  )()`)) as string[];
  const expected = [label(first), label(second)];
  const ticketIsRight =
    ticket.length === expected.length && expected.every((name) => ticket.includes(name));

  const charged = ticketIsRight ? await press(window, charge) : false;
  await pause(800);
  await shoot(window, join(out, "3-after-sale.png"));

  const sales = database
    .prepare("select number, total, payment from sales order by number")
    .all();
  const onHand = listProducts(database).map((p) => ({ name: p.name, onHand: p.onHand }));

  writeFileSync(
    join(out, "walk.json"),
    JSON.stringify({ steps, ticket, ticketIsRight, charged, sales, onHand }, null, 2)
  );
}

export function fixtureFor(root: string): string {
  const named = process.env.OUAQT_DEMO_CONFIG;
  if (named && existsSync(named)) return named;
  return join(root, "fixtures", "configuration.pharmacy.json");
}
