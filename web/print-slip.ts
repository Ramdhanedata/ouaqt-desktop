/*
 * What the printer would have printed, shown on the screen instead.
 *
 * In the builder's preview there is no printer, and a sale that prints its
 * receipt should still be seen to. The exact page the app sends to the
 * printer comes out at the top of the window, the way paper comes out of a
 * receipt printer, stays long enough to read and goes. A click sends it away
 * sooner. Receipts and tickets are drawn at the width of an 80 mm roll;
 * papers printed on A4 are shown as a page, smaller.
 */

const SHOWN_MS = 6000; // not-a-rule: how long a printed slip stays on screen
const ROLL_PX = 302; // not-a-rule: 80 mm at the screen's 96 pixels to the inch
const SHEET_PX = 794; // not-a-rule: 210 mm, an A4 page's width, at 96 pixels to the inch
const SHEET_SCALE = 0.42; // not-a-rule: an A4 page shown small enough to sit beside the till

let tray: HTMLDivElement | null = null;

function trayOf(): HTMLDivElement {
  if (tray) return tray;
  tray = document.createElement("div");
  tray.style.cssText =
    "position:fixed;top:0;inset-inline-end:24px;z-index:1000;display:flex;gap:16px;align-items:flex-start;pointer-events:none";
  document.body.appendChild(tray);
  return tray;
}

export function showPrinted({ html, sheet }: { html: string; sheet: boolean }) {
  const width = sheet ? SHEET_PX : ROLL_PX;
  const scale = sheet ? SHEET_SCALE : 1;

  const slip = document.createElement("button");
  slip.type = "button";
  slip.style.cssText = [
    "pointer-events:auto",
    "padding:0",
    "border:0",
    "background:#fff",
    "overflow:hidden",
    "box-shadow:0 18px 40px -12px rgba(10,10,10,.45)",
    `width:${Math.round(width * scale)}px`,
    "max-height:80vh",
    "cursor:pointer",
    "transform:translateY(-100%)",
    "transition:transform .9s ease-out, opacity .3s",
  ].join(";");

  const page = document.createElement("iframe");
  /* No scripts run in it; same origin only so its height can be read. */
  page.setAttribute("sandbox", "allow-same-origin");
  page.srcdoc = html;
  /* One pixel high to start, so what is measured below is the page and not the frame. */
  page.style.cssText = `border:0;width:${width}px;height:1px;transform:scale(${scale});transform-origin:top left;pointer-events:none;display:block;background:#fff`;
  page.addEventListener("load", () => {
    /* The page's own height, so the whole receipt shows and not a window onto it. */
    const height = page.contentDocument?.documentElement.scrollHeight ?? 400;
    page.style.height = `${height}px`;
    slip.style.height = `${Math.round(height * scale)}px`;
  });
  slip.appendChild(page);

  const gone = () => {
    slip.style.opacity = "0";
    setTimeout(() => slip.remove(), 300); // not-a-rule: ms for the fade
  };
  slip.addEventListener("click", gone);
  trayOf().appendChild(slip);
  requestAnimationFrame(() => requestAnimationFrame(() => (slip.style.transform = "translateY(0)")));
  setTimeout(gone, SHOWN_MS);
}
