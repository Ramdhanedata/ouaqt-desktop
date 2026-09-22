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

  /* The sections down the side of the window. */
  navSale: "Vente",
  navStock: "Stock",
  navCustomers: "Clients",
  navCash: "Caisse",
  navReports: "Rapports",
  navSettings: "Réglages",

  noProducts: "Aucun produit pour l'instant.",
  noProductsBody:
    "Vos produits arrivent avec votre numéro de série, à l'activation. Vous pourrez aussi en ajouter un par un.",
  saleKept: "Vente enregistrée",
  saleFailed: "La vente n'a pas été enregistrée. Elle est encore à l'écran, réessayez.",
  notBuilt: "Cet écran n'est pas encore prêt.",
  notBuiltBody:
    "Il arrive dans une prochaine version. Rien de ce que vous avez enregistré n'est perdu.",
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

  navSale: "بيع",
  navStock: "المخزون",
  navCustomers: "الزبائن",
  navCash: "الصندوق",
  navReports: "التقارير",
  navSettings: "الإعدادات",

  noProducts: "لا توجد منتجات بعد.",
  noProductsBody:
    "تصل منتجاتك مع رقمك التسلسلي عند التفعيل. ويمكنك أيضا إضافتها واحدا واحدا.",
  saleKept: "سجلت عملية البيع",
  saleFailed: "لم تسجل عملية البيع. ما زالت على الشاشة، أعد المحاولة.",
  notBuilt: "هذه الشاشة ليست جاهزة بعد.",
  notBuiltBody: "تأتي في نسخة قادمة. ولم يضع شيء مما سجلته.",
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

  navSale: "Sell",
  navStock: "Stock",
  navCustomers: "Customers",
  navCash: "Till",
  navReports: "Reports",
  navSettings: "Settings",

  noProducts: "No products yet.",
  noProductsBody:
    "Your products arrive with your serial number, at activation. You will also be able to add them one at a time.",
  saleKept: "Sale recorded",
  saleFailed: "The sale was not recorded. It is still on screen, try again.",
  notBuilt: "This screen is not ready yet.",
  notBuiltBody:
    "It arrives in a later version. Nothing you have recorded is lost.",
};

const all: Record<AppLanguage, Copy> = { fr, ar, en };

export function copyFor(language: AppLanguage): Copy {
  return all[language] ?? fr;
}
