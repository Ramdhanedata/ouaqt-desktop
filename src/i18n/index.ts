import type { AppLanguage } from "@app-ui/config";

/*
 * The app's own words. The screens shared with the builder bring their own,
 * from app-ui, so nothing is written twice.
 *
 * A missing key fails the build rather than showing a blank on a counter,
 * which is what the test beside this file checks.
 */

export const fr = {
  starting: "Démarrage",
  noConfiguration: "Ce logiciel n'est pas encore configuré.",
  noConfigurationBody:
    "Il vous faut votre numéro de série, celui que vous avez reçu après avoir créé votre logiciel. L'écran qui le demande arrive à la prochaine étape.",
  badConfiguration: "La configuration de ce logiciel n'a pas pu être lue.",
  badConfigurationBody: "Écrivez-nous sur WhatsApp et nous la refaisons.",
  database: "Base de données",
  ready: "Prête",
  shop: "Votre commerce",
  language: "Langue de l'application",
  sale: "Écran de vente",
} as const;

export type Copy = { readonly [K in keyof typeof fr]: string };

export const ar: Copy = {
  starting: "جاري التشغيل",
  noConfiguration: "لم تتم تهيئة هذا البرنامج بعد.",
  noConfigurationBody:
    "تحتاج رقمك التسلسلي، الذي استلمته بعد إنشاء برنامجك. الشاشة التي تطلبه تأتي في الخطوة القادمة.",
  badConfiguration: "تعذرت قراءة إعدادات هذا البرنامج.",
  badConfigurationBody: "راسلنا على واتساب وسنعيدها.",
  database: "قاعدة البيانات",
  ready: "جاهزة",
  shop: "محلك",
  language: "لغة البرنامج",
  sale: "شاشة البيع",
};

export const en: Copy = {
  starting: "Starting",
  noConfiguration: "This software is not set up yet.",
  noConfigurationBody:
    "You need your serial number, the one you were given after building your software. The screen that asks for it comes next.",
  badConfiguration: "This software's settings could not be read.",
  badConfigurationBody: "Write to us on WhatsApp and we will make them again.",
  database: "Database",
  ready: "Ready",
  shop: "Your shop",
  language: "App language",
  sale: "Sale screen",
};

const all: Record<AppLanguage, Copy> = { fr, ar, en };

export function copyFor(language: AppLanguage): Copy {
  return all[language] ?? fr;
}
