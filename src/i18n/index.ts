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
  /* Activation. He is setting up his shop, not installing software. */
  activateTitle: "Votre numéro de série",
  activateBody:
    "Tapez le numéro que vous avez reçu à la fin de la configuration de votre commerce. Il est aussi dans votre compte, sur le site.",
  serialLabel: "Numéro de série",
  activateButton: "Valider",
  activating: "Un instant, nous préparons votre commerce.",
  activateNeedsInternet:
    "Il faut internet une seule fois, pour cette étape. Ensuite, le logiciel marche sans.",
  errorUnknownSerial:
    "Ce numéro ne correspond à aucun commerce. Vérifiez chaque caractère : il est dans votre compte, sur le site.",
  errorDeviceLimit:
    "Votre licence couvre déjà tous ses ordinateurs. Libérez-en un depuis votre compte sur le site, ou écrivez-nous.",
  errorTrialRefused:
    "Nous ne pouvons pas ouvrir d'essai gratuit sur cet ordinateur. Écrivez-nous sur WhatsApp et nous regardons ça avec vous.",
  errorOldVersion:
    "Cette version du logiciel est trop ancienne pour être activée. Téléchargez la dernière depuis le site.",
  errorOtherShop:
    "Cet ordinateur contient déjà les données d'un autre commerce. Rien n'a été effacé. Pour les garder, réglez la licence de ce commerce ; sinon, écrivez-nous.",
  errorLinkExpired:
    "Le lien du site a expiré ou a déjà servi. Tapez votre numéro de série : il est affiché sur la page du site et dans votre compte.",
  errorNoNetwork:
    "Pas de connexion à internet. Connectez cet ordinateur une fois, le temps de cette étape.",
  errorAlreadyActive: "Votre logiciel est déjà prêt sur cet ordinateur.",
  errorGeneric:
    "La préparation de votre commerce n'a pas abouti. Écrivez-nous sur WhatsApp, nous réglons ça avec vous.",
  whatsapp: "Écrire sur WhatsApp",

  testBanner: "Version de test. À ne pas utiliser pour de vraies ventes.",
  readOnlyTrial:
    "Votre essai gratuit est terminé. Tout ce que vous avez enregistré reste visible, mais vous ne pouvez plus vendre. Réglez votre licence sur le site OUAQT avec votre numéro de série, et tout se rouvre.",
  readOnlyExpired:
    "Votre licence a expiré. Tout ce que vous avez enregistré reste visible, mais vous ne pouvez plus vendre. Réglez votre licence sur le site OUAQT avec votre numéro de série, et tout se rouvre.",
  readOnlySuspended: "Votre licence est suspendue. Écrivez-nous sur WhatsApp.",
  clockWrong:
    "L'heure de cet ordinateur paraît fausse. Remettez-la à l'heure, puis connectez-le une fois à internet.",
  /*
   * One line per plural form, because Arabic has six and French two. Picked
   * with Intl.PluralRules, so "30" reads as Arabic writes thirty days.
   */
  trialLeftZero: "Essai gratuit : dernier jour",
  trialLeftOne: "Essai gratuit : {count} jour restant",
  trialLeftTwo: "Essai gratuit : {count} jours restants",
  trialLeftFew: "Essai gratuit : {count} jours restants",
  trialLeftMany: "Essai gratuit : {count} jours restants",
  trialLeftOther: "Essai gratuit : {count} jours restants",
  licenceEndsOn: "Votre licence se termine le {date}.",
  licenceInGrace: "Votre licence a pris fin le {date}. Le logiciel continue jusqu'au {until}, puis passe en lecture seule.",
  renewHow: "Renouvelez-la sur le site OUAQT avec votre numéro de série.",
  payOnSite: "Payer sur le site",
  dismissToday: "Fermer",
  trialEndedTitle: "Votre essai gratuit est terminé",
  licenceEndedTitle: "Votre licence a pris fin",
  trialEndedBody:
    "Merci d'avoir utilisé OUAQT pendant ces {days} jours gratuits. Pour continuer à vendre, il suffit de payer votre licence avec votre numéro de série. Si vous avez une question, écrivez-nous : nous sommes là pour vous aider. Tout ce que vous avez enregistré est gardé.",
  licenceEndedBody:
    "Merci de votre confiance. Pour continuer à vendre, renouvelez votre licence avec votre numéro de série. Si vous avez une question, écrivez-nous : nous sommes là pour vous aider. Tout ce que vous avez enregistré est gardé.",
  phoneTitle: "Sur votre téléphone (le plus simple)",
  phoneSteps: "Scannez ce code avec votre téléphone|Choisissez votre application et payez|Envoyez la capture d'écran du paiement",
  phoneType: "Ou ouvrez {address} et tapez votre numéro de série.",
  scanAlt: "Code à scanner pour payer",
  computerTitle: "Sur cet ordinateur",
  payNow: "Payer sur le site",
  payNowHow: "La page s'ouvre avec votre numéro de série. Il vous faut la capture d'écran du paiement sur cet ordinateur.",
  reopens: "Dès que le paiement est confirmé, le logiciel se rouvre tout seul.",
  contactOuaqt: "Écrire à OUAQT sur WhatsApp",
  checkNow: "J'ai payé : vérifier",
  checking: "Vérification en cours",
  notYet: "Pas encore de paiement confirmé. Le logiciel vérifie tout seul toutes les {seconds} secondes.",
  offline: "Pas de connexion à internet pour le moment. Le logiciel réessaie tout seul.",
  paidOpening: "Paiement confirmé. Le logiciel se rouvre.",
  yourSerial: "Votre numéro de série",
  copySerial: "Copier",
  copiedSerial: "Copié",
  seeData: "Voir mes données",
  saleReadOnly: "Vente refusée : le logiciel est en lecture seule.",
  updateReady:
    "Une nouvelle version est prête. Elle s'installera la prochaine fois que vous fermerez le logiciel.",
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
  activateTitle: "رقمك التسلسلي",
  activateBody:
    "اكتب الرقم الذي استلمته في نهاية إعداد محلك. وهو موجود أيضا في حسابك على الموقع.",
  serialLabel: "الرقم التسلسلي",
  activateButton: "تأكيد",
  activating: "لحظة، نجهز محلك.",
  activateNeedsInternet: "تحتاج الإنترنت مرة واحدة لهذه الخطوة. بعد ذلك يعمل البرنامج دونه.",
  errorUnknownSerial:
    "هذا الرقم لا يطابق أي محل. تحقق من كل حرف: الرقم موجود في حسابك على الموقع.",
  errorDeviceLimit:
    "رخصتك تغطي كل حواسيبها بالفعل. حرر واحدا من حسابك على الموقع، أو راسلنا.",
  errorTrialRefused:
    "لا نستطيع فتح تجربة مجانية على هذا الحاسوب. راسلنا على واتساب وننظر في الأمر معك.",
  errorOldVersion: "هذه النسخة من البرنامج قديمة جدا. نزل آخر نسخة من الموقع.",
  errorOtherShop:
    "هذا الحاسوب يحتوي بالفعل على بيانات محل آخر. لم يحذف أي شيء. للاحتفاظ بها، سدد رخصة ذلك المحل، أو راسلنا.",
  errorLinkExpired:
    "انتهت صلاحية رابط الموقع أو استعمل من قبل. اكتب رقمك التسلسلي: هو ظاهر في صفحة الموقع وفي حسابك.",
  errorNoNetwork: "لا يوجد اتصال بالإنترنت. صل هذا الحاسوب مرة واحدة لهذه الخطوة.",
  errorAlreadyActive: "برنامجك جاهز بالفعل على هذا الحاسوب.",
  errorGeneric: "لم يكتمل تجهيز محلك. راسلنا على واتساب ونحل الأمر معك.",
  whatsapp: "مراسلة على واتساب",

  testBanner: "نسخة اختبار. لا تستعملها في مبيعات حقيقية.",
  readOnlyTrial:
    "انتهت تجربتك المجانية. كل ما سجلته يبقى ظاهرا، لكن لا يمكنك البيع. سدد رخصتك على موقع OUAQT برقمك التسلسلي فيعود كل شيء.",
  readOnlyExpired:
    "انتهت رخصتك. كل ما سجلته يبقى ظاهرا، لكن لا يمكنك البيع. سدد رخصتك على موقع OUAQT برقمك التسلسلي فيعود كل شيء.",
  readOnlySuspended: "رخصتك موقوفة. راسلنا على واتساب.",
  clockWrong: "يبدو أن ساعة هذا الحاسوب خاطئة. اضبطها، ثم صله بالإنترنت مرة واحدة.",
  trialLeftZero: "التجربة المجانية: اليوم الأخير",
  trialLeftOne: "التجربة المجانية: بقي يوم واحد",
  trialLeftTwo: "التجربة المجانية: بقي يومان",
  trialLeftFew: "التجربة المجانية: بقيت {count} أيام",
  trialLeftMany: "التجربة المجانية: بقي {count} يوما",
  trialLeftOther: "التجربة المجانية: بقي {count} يوم",
  licenceEndsOn: "تنتهي رخصتك في {date}.",
  licenceInGrace: "انتهت رخصتك في {date}. يواصل البرنامج العمل حتى {until}، ثم يصير للقراءة فقط.",
  renewHow: "جددها على موقع OUAQT برقمك التسلسلي.",
  payOnSite: "الدفع على الموقع",
  dismissToday: "إغلاق",
  trialEndedTitle: "انتهت تجربتك المجانية",
  licenceEndedTitle: "انتهت رخصتك",
  trialEndedBody:
    "شكرا لأنك استعملت OUAQT مجانا طوال {days} يوما. لتواصل البيع، يكفي أن تدفع رخصتك برقمك التسلسلي. وإن كان لديك سؤال فراسلنا، نحن هنا لمساعدتك. كل ما سجلته محفوظ.",
  licenceEndedBody:
    "شكرا لثقتك. لتواصل البيع، جدد رخصتك برقمك التسلسلي. وإن كان لديك سؤال فراسلنا، نحن هنا لمساعدتك. كل ما سجلته محفوظ.",
  phoneTitle: "على هاتفك (الأسهل)",
  phoneSteps: "امسح هذا الرمز بهاتفك|اختر تطبيقك وادفع|أرسل صورة شاشة الدفع",
  phoneType: "أو افتح {address} واكتب رقمك التسلسلي.",
  scanAlt: "رمز للمسح من أجل الدفع",
  computerTitle: "على هذا الحاسوب",
  payNow: "الدفع على الموقع",
  payNowHow: "تفتح الصفحة برقمك التسلسلي. تحتاج صورة شاشة الدفع على هذا الحاسوب.",
  reopens: "حالما يتأكد الدفع، يعود البرنامج إلى العمل وحده.",
  contactOuaqt: "مراسلة OUAQT على واتساب",
  checkNow: "دفعت: تحقق الآن",
  checking: "جار التحقق",
  notYet: "لم يتأكد أي دفع بعد. يتحقق البرنامج وحده كل {seconds} ثانية.",
  offline: "لا يوجد اتصال بالإنترنت الآن. سيعيد البرنامج المحاولة وحده.",
  paidOpening: "تأكد الدفع. البرنامج يعود إلى العمل.",
  yourSerial: "رقمك التسلسلي",
  copySerial: "نسخ",
  copiedSerial: "تم النسخ",
  seeData: "عرض بياناتي",
  saleReadOnly: "رفض البيع: البرنامج في وضع القراءة فقط.",
  updateReady: "نسخة جديدة جاهزة. ستثبت في المرة القادمة التي تغلق فيها البرنامج.",
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
  activateTitle: "Your serial number",
  activateBody:
    "Type the number you received when you finished setting up your shop. It is also in your account, on the website.",
  serialLabel: "Serial number",
  activateButton: "Confirm",
  activating: "One moment, we are getting your shop ready.",
  activateNeedsInternet:
    "This step needs internet once. After that the software works without it.",
  errorUnknownSerial:
    "This number does not match any shop. Check each character: it is in your account, on the website.",
  errorDeviceLimit:
    "Your licence already covers all its computers. Free one from your account on the website, or write to us.",
  errorTrialRefused:
    "We cannot open a free trial on this computer. Write to us on WhatsApp and we will look at it with you.",
  errorOldVersion: "This version of the software is too old to activate. Download the latest from the website.",
  errorOtherShop:
    "This computer already holds another shop's data. Nothing has been deleted. To keep it, pay that shop's licence; otherwise, write to us.",
  errorLinkExpired:
    "The link from the website has expired or was already used. Type your serial number: it is shown on the website page and in your account.",
  errorNoNetwork: "No internet connection. Connect this computer once, for this step.",
  errorAlreadyActive: "Your software is already set up on this computer.",
  errorGeneric: "Setting up your shop did not finish. Write to us on WhatsApp and we will sort it out with you.",
  whatsapp: "Write on WhatsApp",

  testBanner: "Test version. Not for real sales.",
  readOnlyTrial:
    "Your free trial has ended. Everything you recorded stays visible, but you can no longer sell. Pay your licence on the OUAQT website with your serial number, and everything opens again.",
  readOnlyExpired:
    "Your licence has expired. Everything you recorded stays visible, but you can no longer sell. Pay your licence on the OUAQT website with your serial number, and everything opens again.",
  readOnlySuspended: "Your licence is suspended. Write to us on WhatsApp.",
  clockWrong: "This computer's clock looks wrong. Set it right, then connect it to the internet once.",
  trialLeftZero: "Free trial: last day",
  trialLeftOne: "Free trial: {count} day left",
  trialLeftTwo: "Free trial: {count} days left",
  trialLeftFew: "Free trial: {count} days left",
  trialLeftMany: "Free trial: {count} days left",
  trialLeftOther: "Free trial: {count} days left",
  licenceEndsOn: "Your licence ends on {date}.",
  licenceInGrace: "Your licence ended on {date}. The software keeps working until {until}, then turns read-only.",
  renewHow: "Renew it on the OUAQT website with your serial number.",
  payOnSite: "Pay on the website",
  dismissToday: "Close",
  trialEndedTitle: "Your free trial has ended",
  licenceEndedTitle: "Your licence has ended",
  trialEndedBody:
    "Thank you for using OUAQT for these {days} free days. To keep selling, just pay for your licence with your serial number. If you have a question, write to us: we are here to help. Everything you recorded is kept.",
  licenceEndedBody:
    "Thank you for your trust. To keep selling, renew your licence with your serial number. If you have a question, write to us: we are here to help. Everything you recorded is kept.",
  phoneTitle: "On your phone (easiest)",
  phoneSteps: "Scan this code with your phone|Choose your app and pay|Send the screenshot of the payment",
  phoneType: "Or open {address} and type your serial number.",
  scanAlt: "Code to scan to pay",
  computerTitle: "On this computer",
  payNow: "Pay on the website",
  payNowHow: "The page opens with your serial number. You need the screenshot of the payment on this computer.",
  reopens: "As soon as the payment is confirmed, the software opens again by itself.",
  contactOuaqt: "Write to OUAQT on WhatsApp",
  checkNow: "I have paid: check now",
  checking: "Checking",
  notYet: "No confirmed payment yet. The software checks by itself every {seconds} seconds.",
  offline: "No internet connection right now. The software tries again by itself.",
  paidOpening: "Payment confirmed. The software is opening.",
  yourSerial: "Your serial number",
  copySerial: "Copy",
  copiedSerial: "Copied",
  seeData: "See my data",
  saleReadOnly: "Sale refused: the software is read-only.",
  updateReady: "A new version is ready. It installs the next time you close the software.",
};

const all: Record<AppLanguage, Copy> = { fr, ar, en };

export function copyFor(language: AppLanguage): Copy {
  return all[language] ?? fr;
}

/*
 * The line for a count of days, in the form that language uses for that
 * number. Arabic says يومان for two, أيام from three to ten and يوما from
 * eleven to ninety-nine; getting that wrong on the owner's own till is the
 * kind of thing that tells him nobody who speaks his language checked.
 */
export function daysLeftLine(copy: Copy, language: string, count: number): string {
  const form = new Intl.PluralRules(language).select(count);
  const key = {
    zero: "trialLeftZero",
    one: "trialLeftOne",
    two: "trialLeftTwo",
    few: "trialLeftFew",
    many: "trialLeftMany",
    other: "trialLeftOther",
  }[form] as keyof Copy;
  return copy[key].replace("{count}", String(count));
}
