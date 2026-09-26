/*
 * The app's icons: the OUAQT tile, and one per trade.
 *
 *   npx electron scripts/make-icons.cjs
 *
 * Writes build/icon.png and build/icon.ico (the installer, and the app
 * before it knows its shop) and build/trade-icons/<trade>.png and .ico,
 * which the app puts on itself once it knows which trade it serves
 * (electron/icon.ts). Each is the gold symbol the website shows for that
 * trade, on the black tile.
 *
 * The symbols are Lucide's (ISC licence), kept as SVG in
 * build/trade-icons/symbols.json so nothing needs installing. Every size is
 * drawn on a canvas at that size, so a 16 pixel icon is drawn at 16 rather
 * than shrunk from a large one. The ICO holds PNG images, which every
 * Windows since Vista reads.
 */
const { app, BrowserWindow } = require("electron");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const OUT = join(__dirname, "..", "build");
const SYMBOLS = JSON.parse(readFileSync(join(OUT, "trade-icons", "symbols.json"), "utf8"));
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/* The Mac draws icons on a grid with room around the tile; Windows fills its square. */
const MAC_MARGIN = 100 / 1024;
const WINDOWS_MARGIN = 40 / 1024;

function drawScript(symbol, size, margin) {
  return `(async () => {
    const size = ${size};
    const inset = Math.round(size * ${margin});
    const tile = size - inset * 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext("2d");
    c.beginPath();
    c.roundRect(inset, inset, tile, tile, tile * 0.225);
    const fill = c.createLinearGradient(inset, inset, inset + tile * 0.5, inset + tile);
    fill.addColorStop(0, "#24211c");
    fill.addColorStop(0.7, "#0a0a0a");
    c.fillStyle = fill;
    c.fill();
    if (size >= 48) {
      c.lineWidth = Math.max(1, tile * 0.006);
      c.strokeStyle = "rgba(201,169,97,0.3)";
      c.stroke();
    }
    const image = new Image();
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(${JSON.stringify(symbol)});
    await image.decode();
    const glyph = tile * (size <= 24 ? 0.72 : 0.56);
    c.drawImage(image, (size - glyph) / 2, (size - glyph) / 2, glyph, glyph);
    return canvas.toDataURL("image/png");
  })()`;
}

function ico(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((one) => one.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL("data:text/html,<!doctype html><title>icons</title>");
  const render = async (symbol, size, margin) => {
    const url = await win.webContents.executeJavaScript(drawScript(symbol, size, margin));
    return Buffer.from(url.split(",")[1], "base64");
  };
  mkdirSync(join(OUT, "trade-icons"), { recursive: true });
  for (const [name, symbol] of Object.entries(SYMBOLS)) {
    const brand = name === "ouaqt";
    const base = brand ? join(OUT, "icon") : join(OUT, "trade-icons", name);
    writeFileSync(base + ".png", await render(symbol, brand ? 1024 : 512, MAC_MARGIN));
    const pngs = [];
    for (const size of ICO_SIZES) pngs.push({ size, data: await render(symbol, size, size <= 32 ? 0 : WINDOWS_MARGIN) });
    writeFileSync(base + ".ico", ico(pngs));
    console.log("icon", name);
  }
  app.quit();
});
