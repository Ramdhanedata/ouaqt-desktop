/*
 * A page the app would print, on a phone.
 *
 * A phone in a browser cannot reach the shop's receipt printer, so a receipt,
 * a list or a statement opens over the screen as the page itself, with two
 * buttons: one hands it to the phone's own print sheet, which on Android and
 * iPhone also saves it as a PDF or shares it on WhatsApp, and one closes it.
 *
 * Built with the DOM directly rather than React, because it is called from
 * the main side (the handlers), which has no React tree of its own.
 */

const WORDS = {
  fr: { print: "Imprimer ou partager", close: "Fermer" },
  ar: { print: "طباعة أو مشاركة", close: "إغلاق" },
  en: { print: "Print or share", close: "Close" },
} as const;

type Language = keyof typeof WORDS;

export function showPaper(html: string, language: string, narrow: boolean): void {
  const words = WORDS[(language as Language) in WORDS ? (language as Language) : "fr"];
  const rtl = language === "ar";

  const sheet = document.createElement("div");
  sheet.setAttribute("role", "dialog");
  sheet.dir = rtl ? "rtl" : "ltr";
  sheet.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:1000",
    "display:flex",
    "flex-direction:column",
    "background:var(--background, #f0eee6)",
    "padding-top:env(safe-area-inset-top)",
    "padding-bottom:env(safe-area-inset-bottom)",
  ].join(";");

  const frameBox = document.createElement("div");
  frameBox.style.cssText = "flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;display:flex;justify-content:center;padding:12px";
  const page = document.createElement("iframe");
  /* Its own scripts never run; same origin so its height can be read, modals so print() is allowed. */
  page.setAttribute("sandbox", "allow-same-origin allow-modals");
  page.srcdoc = html;
  page.title = words.print;
  page.style.cssText = `border:0;background:#fff;width:${narrow ? 302 : 794}px;max-width:100%;height:1px;box-shadow:0 10px 30px -12px rgba(10,10,10,.4)`; // not-a-rule: 80 mm and A4 at 96 dpi
  page.addEventListener("load", () => {
    const height = page.contentDocument?.documentElement.scrollHeight ?? 600;
    page.style.height = `${height}px`;
  });
  frameBox.appendChild(page);

  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:8px;padding:12px;border-top:1px solid var(--line, #ddd);background:var(--surface, #fff)";
  const button = (label: string, primary: boolean, onClick: () => void) => {
    const one = document.createElement("button");
    one.type = "button";
    one.textContent = label;
    one.style.cssText = [
      "flex:1",
      "min-height:52px",
      "border-radius:10px",
      "font:inherit",
      "font-size:17px",
      "font-weight:600",
      primary ? "background:rgb(var(--ink, 10 10 10));color:rgb(var(--on-ink, 255 255 255));border:0" : "background:var(--surface, #fff);color:rgb(var(--ink, 10 10 10));border:2px solid var(--line-strong, #bbb)",
    ].join(";");
    one.addEventListener("click", onClick);
    return one;
  };
  const close = () => sheet.remove();
  bar.appendChild(button(words.print, true, () => page.contentWindow?.print()));
  bar.appendChild(button(words.close, false, close));

  sheet.appendChild(frameBox);
  sheet.appendChild(bar);
  document.body.appendChild(sheet);
}
