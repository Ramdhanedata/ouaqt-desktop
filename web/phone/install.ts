import { existsSync, readFileSync, writeFileSync, join, SHOP_FOLDER } from "./disk";

/*
 * Asking, once the shop is open, for the app to be put on the home screen.
 *
 * Opened in the browser, the app is a page among others: it works, but there
 * is no icon, and a browser tab is easy to close. On the home screen it opens
 * full screen from its own icon. Android can do it from a button, through the
 * browser's own install prompt; an iPhone cannot be asked from a page, so it
 * is told where to tap.
 *
 * Never shown once it is installed, and not again for a week after "Plus
 * tard".
 */

const FILE = join(SHOP_FOLDER, "install-asked");
const AGAIN_AFTER_MS = 7 * 86_400_000; // not-a-rule: a week before asking again

const WORDS = {
  fr: {
    title: "Mettez le logiciel sur votre écran d'accueil",
    body: "Il s'ouvrira depuis son icône, en plein écran, même sans internet.",
    install: "Installer",
    iphone: "Touchez le bouton Partager en bas de Safari, puis « Sur l'écran d'accueil ».",
    android: "Touchez le menu ⋮ du navigateur, puis « Ajouter à l'écran d'accueil ».",
    later: "Plus tard",
  },
  ar: {
    title: "ضع البرنامج على الشاشة الرئيسية",
    body: "سيفتح من أيقونته، بملء الشاشة، حتى دون إنترنت.",
    install: "تثبيت",
    iphone: "اضغط زر المشاركة أسفل سفاري، ثم «إضافة إلى الشاشة الرئيسية».",
    android: "اضغط قائمة المتصفح ⋮، ثم «إضافة إلى الشاشة الرئيسية».",
    later: "لاحقا",
  },
  en: {
    title: "Put the software on your home screen",
    body: "It will open from its own icon, full screen, even with no internet.",
    install: "Install",
    iphone: "Tap the Share button at the bottom of Safari, then \"Add to Home Screen\".",
    android: "Tap the browser's ⋮ menu, then \"Add to Home screen\".",
    later: "Later",
  },
} as const;

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallPrompt | null = null;

/* Android's own install prompt, kept for the button. Listened for from the start, since it can come early. */
export function listenForInstall(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPrompt;
  });
}

export function installed(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function askedLately(): boolean {
  if (!existsSync(FILE)) return false;
  const at = Date.parse(String(readFileSync(FILE, "utf8")));
  return Number.isFinite(at) && Date.now() - at < AGAIN_AFTER_MS;
}

export function offerInstall(language: string): void {
  if (installed() || askedLately() || document.getElementById("ouaqt-install")) return;
  const iphone = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const android = /Android/i.test(navigator.userAgent);
  if (!iphone && !android) return;
  const words = WORDS[(language as keyof typeof WORDS) in WORDS ? (language as keyof typeof WORDS) : "fr"];

  const card = document.createElement("div");
  card.id = "ouaqt-install";
  card.setAttribute("role", "dialog");
  card.dir = language === "ar" ? "rtl" : "ltr";
  card.style.cssText = [
    "position:fixed",
    "inset-inline:12px",
    "top:calc(12px + env(safe-area-inset-top))",
    "z-index:60",
    "padding:16px",
    "border-radius:14px",
    "background:var(--surface, #faf9f5)",
    "color:rgb(var(--ink, 10 10 10))",
    "border:2px solid var(--line-strong, #cfcbc0)",
    "box-shadow:0 18px 40px -16px rgba(10,10,10,.45)",
    "font-size:16px",
    "line-height:1.45",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = words.title;
  title.style.cssText = "font-weight:700;font-size:17px";
  const body = document.createElement("div");
  body.textContent = deferred || !android ? words.body : `${words.body} ${words.android}`;
  body.style.cssText = "margin-top:4px;color:var(--ink-2, #3d3c38)";
  card.append(title, body);
  if (iphone) {
    const how = document.createElement("div");
    how.textContent = words.iphone;
    how.style.cssText = "margin-top:8px;font-weight:600";
    card.append(how);
  }

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;margin-top:12px";
  const button = (label: string, primary: boolean, onClick: () => void) => {
    const one = document.createElement("button");
    one.type = "button";
    one.textContent = label;
    one.style.cssText = [
      "flex:1",
      "min-height:48px",
      "border-radius:10px",
      "font:inherit",
      "font-weight:600",
      primary
        ? "background:rgb(var(--ink, 10 10 10));color:rgb(var(--on-ink, 250 249 245));border:0"
        : "background:transparent;color:rgb(var(--ink, 10 10 10));border:2px solid var(--line-strong, #cfcbc0)",
    ].join(";");
    one.addEventListener("click", onClick);
    return one;
  };
  const close = () => {
    writeFileSync(FILE, new Date().toISOString(), "utf8");
    card.remove();
  };
  if (deferred) {
    row.append(
      button(words.install, true, () => {
        const asking = deferred;
        deferred = null;
        void asking?.prompt().finally(() => card.remove());
      })
    );
  }
  row.append(button(words.later, !deferred, close));
  card.append(row);
  document.body.appendChild(card);
}
