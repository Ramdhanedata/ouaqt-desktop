import { installed } from "./install";

/*
 * On an iPhone, the shop opens from the home screen and nowhere else.
 *
 * An iPhone keeps two separate stores for one address: one for the page in
 * Safari, one for the same page on the home screen. A shop opened in both
 * would be two shops on one phone, taking two of the licence's devices, with
 * the sales split between them. And Safari erases a site's storage after a
 * week unused, which the home screen does not. So before anything is
 * activated, an iPhone in Safari is told how to put the app on the home
 * screen, and that is all this page does there.
 *
 * The link's serial has to reach the icon. With no manifest to name a start
 * address, an iPhone saves the address on screen, so the manifest is taken
 * away and the address is left as it came, the serial after the #. If it
 * does not get there, the icon opens on the serial screen, and the number is
 * here to copy.
 *
 * A shop already open in Safari, from before this screen existed, keeps
 * opening there: nobody is locked out of their own sales.
 */

const WORDS = {
  fr: {
    title: "Ajoutez OUAQT à votre écran d'accueil",
    why: "Sur iPhone, votre logiciel s'ouvre depuis son icône : vos ventes y restent, et l'iPhone compte pour un seul appareil.",
    steps: [
      "Touchez le bouton Partager (le carré avec une flèche), en bas de Safari.",
      "Touchez « Sur l'écran d'accueil », puis « Ajouter ».",
      "Ouvrez OUAQT depuis son icône : votre commerce s'y ouvre.",
    ],
    number: "Si le logiciel vous demande un numéro, c'est celui-ci :",
    copy: "Copier le numéro",
    copied: "Copié",
    notSafari: "Vous ne voyez pas le bouton Partager ? Ouvrez cette page dans Safari.",
    copyLink: "Copier le lien",
  },
  ar: {
    title: "أضف OUAQT إلى الشاشة الرئيسية",
    why: "على الآيفون، يفتح برنامجك من أيقونته: تبقى مبيعاتك محفوظة، ويُحتسب الآيفون جهازا واحدا.",
    steps: [
      "اضغط زر المشاركة (المربع مع السهم)، أسفل سفاري.",
      "اضغط «إضافة إلى الشاشة الرئيسية»، ثم «إضافة».",
      "افتح OUAQT من أيقونته: سيفتح متجرك هناك.",
    ],
    number: "إذا طلب البرنامج رقما، فهذا هو:",
    copy: "نسخ الرقم",
    copied: "تم النسخ",
    notSafari: "لا ترى زر المشاركة؟ افتح هذه الصفحة في سفاري.",
    copyLink: "نسخ الرابط",
  },
  en: {
    title: "Add OUAQT to your home screen",
    why: "On an iPhone, your software opens from its icon: your sales stay there, and the iPhone counts as one device.",
    steps: [
      "Tap the Share button (the square with an arrow), at the bottom of Safari.",
      "Tap \"Add to Home Screen\", then \"Add\".",
      "Open OUAQT from its icon: your business opens there.",
    ],
    number: "If the software asks for a number, it is this one:",
    copy: "Copy the number",
    copied: "Copied",
    notSafari: "Can't see the Share button? Open this page in Safari.",
    copyLink: "Copy the link",
  },
} as const;

type Language = keyof typeof WORDS;

/* An iPad says it is a Mac, and only its touch screen gives it away. */
function anIPhone(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function mustOpenFromHomeScreen(): boolean {
  return anIPhone() && !installed();
}

function languageHere(): Language {
  const named = /(?:^|[#&])lang=(fr|ar|en)\b/.exec(window.location.hash)?.[1];
  if (named) return named as Language;
  const phone = navigator.language.slice(0, 2);
  return phone === "ar" || phone === "en" ? phone : "fr";
}

export function showHomeScreenSteps(): void {
  document.querySelector('link[rel="manifest"]')?.remove();

  const language = languageHere();
  const words = WORDS[language];
  const serial = /(?:^|[#&])serial=([A-Za-z0-9-]{6,20})/.exec(window.location.hash)?.[1] ?? null;
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.body.style.cssText = "height:auto;min-height:100%";
  const root = document.getElementById("root");
  if (!root) return;
  root.style.height = "auto";
  root.innerHTML = "";

  const page = document.createElement("main");
  page.id = "ouaqt-home-screen";
  page.style.cssText = [
    "box-sizing:border-box",
    "max-width:32rem",
    "margin:auto",
    "padding:calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom))",
    "color:#0a0a0a",
    "font:17px/1.5 system-ui,-apple-system,sans-serif",
  ].join(";");

  const text = (tag: string, content: string, style: string) => {
    const element = document.createElement(tag);
    element.textContent = content;
    element.style.cssText = style;
    return element;
  };
  const copyButton = (label: string, value: string) => {
    const button = text("button", label, "width:100%;min-height:48px;margin-top:12px;border-radius:10px;border:2px solid #cfcbc0;background:transparent;color:inherit;font:inherit;font-weight:600");
    (button as HTMLButtonElement).type = "button";
    button.addEventListener("click", () => {
      void navigator.clipboard?.writeText(value).then(() => {
        button.textContent = words.copied;
      });
    });
    return button;
  };

  page.append(text("h1", words.title, "margin:0;font-size:24px;line-height:1.25;font-weight:700"));
  page.append(text("p", words.why, "margin:12px 0 0;color:#3d3c38"));

  const steps = document.createElement("ol");
  steps.style.cssText = "margin:20px 0 0;padding-inline-start:24px;font-weight:600";
  for (const step of words.steps) steps.append(text("li", step, "margin-top:12px"));
  page.append(steps);

  if (serial) {
    const box = document.createElement("div");
    box.style.cssText = "margin-top:24px;padding:16px;border-radius:14px;border:2px solid #cfcbc0;background:#faf9f5";
    box.append(text("p", words.number, "margin:0;color:#3d3c38"));
    const number = text("p", serial, "margin:8px 0 0;font:600 22px/1.3 ui-monospace,Menlo,monospace;letter-spacing:.12em");
    number.dir = "ltr";
    box.append(number, copyButton(words.copy, serial));
    page.append(box);
  }

  page.append(text("p", words.notSafari, "margin:24px 0 0;color:#3d3c38"));
  page.append(copyButton(words.copyLink, window.location.href));
  root.append(page);
}
