import type { AppLanguage, Configuration, Pack } from "@app-ui/config";

/*
 * What a product is called, and how it is looked for, in each trade.
 *
 * A pharmacy sells medicines by brand name and DCI and scans their boxes; a
 * restaurant has dishes; a warehouse has articles with a reference; a hotel
 * has services. The screens are shared, the words are not: a restaurant
 * owner should never read "DCI" or "ordonnance" in his own software.
 *
 * `searchCode` and `hintCode` are for a shop that finds products by barcode
 * too, as its configuration says.
 */

export type ProductWords = {
  search: string;
  searchCode: string;
  hint: string;
  hintCode: string;
  /* The label of the name field on a product's form. */
  name: string;
  unitHint: string;
  /* Why a sale is cancelled, as offered in Rapports, separated by |. */
  voidReasons: string;
  /* What one of them is called at the head of a list, and the button that adds one. */
  item: string;
  newItem: string;
  /* The label of what it costs him; empty where the trade does not record it. */
  cost: string;
  /* What he has of it on the day he adds it; empty where nothing is counted. */
  opening: string;
};

type Words = Record<Pack, ProductWords>;

const fr: Words = {
  pharmacy: {
    search: "Nom ou DCI",
    searchCode: "Nom, DCI ou code-barres",
    hint: "Tapez les premières lettres d'un médicament ou de sa DCI.",
    hintCode: "Tapez les premières lettres d'un médicament, ou scannez sa boîte.",
    name: "Nom commercial",
    unitHint: "Boîte, flacon, tube…",
    voidReasons: "Retour client|Erreur de saisie|Erreur de prix|Produit abîmé ou périmé|Ordonnance annulée",
    item: "Produit",
    newItem: "Nouveau produit",
    cost: "Prix d'achat",
    opening: "Quantité en rayon aujourd'hui",
  },
  shop: {
    search: "Nom du produit",
    searchCode: "Nom ou code-barres",
    hint: "Tapez les premières lettres d'un produit.",
    hintCode: "Tapez les premières lettres d'un produit, ou scannez son code-barres.",
    name: "Nom du produit",
    unitHint: "Pièce, kg, litre, paquet…",
    voidReasons: "Retour client|Erreur de saisie|Erreur de prix|Produit abîmé",
    item: "Produit",
    newItem: "Nouveau produit",
    cost: "Prix d'achat",
    opening: "Quantité en rayon aujourd'hui",
  },
  bakery: {
    search: "Nom du produit",
    searchCode: "Nom du produit",
    hint: "Tapez les premières lettres d'un pain ou d'une pâtisserie.",
    hintCode: "Tapez les premières lettres d'un pain ou d'une pâtisserie.",
    name: "Nom du produit",
    unitHint: "Pièce, kg, plateau…",
    voidReasons: "Erreur de saisie|Erreur de prix|Produit abîmé|Commande annulée",
    item: "Produit",
    newItem: "Nouveau produit",
    cost: "Coût de fabrication",
    opening: "Quantité en rayon aujourd'hui",
  },
  warehouse: {
    search: "Nom de l'article",
    searchCode: "Nom, référence ou code-barres",
    hint: "Tapez les premières lettres d'un article.",
    hintCode: "Tapez les premières lettres d'un article, ou scannez son code.",
    name: "Nom de l'article",
    unitHint: "Carton, sac, pièce, kg, litre…",
    voidReasons: "Retour client|Erreur de saisie|Erreur de prix|Marchandise abîmée",
    item: "Article",
    newItem: "Nouvel article",
    cost: "Prix d'achat",
    opening: "Quantité en stock aujourd'hui",
  },
  general: {
    search: "Nom du produit ou du service",
    searchCode: "Nom ou code-barres",
    hint: "Tapez les premières lettres d'un produit ou d'un service.",
    hintCode: "Tapez les premières lettres d'un produit ou d'un service, ou scannez son code-barres.",
    name: "Nom",
    unitHint: "Pièce, heure, kg…",
    voidReasons: "Retour client|Erreur de saisie|Erreur de prix|Prestation annulée",
    item: "Produit ou service",
    newItem: "Ajouter un produit ou un service",
    cost: "Prix d'achat",
    opening: "Quantité en rayon aujourd'hui",
  },
  restaurant: {
    search: "Nom du plat",
    searchCode: "Nom du plat",
    hint: "Tapez les premières lettres d'un plat.",
    hintCode: "Tapez les premières lettres d'un plat.",
    name: "Nom du plat",
    unitHint: "",
    voidReasons: "Erreur de saisie|Erreur de prix|Plat renvoyé|Commande annulée",
    item: "Plat",
    newItem: "Nouveau plat",
    cost: "",
    opening: "",
  },
  hotel: {
    search: "Nom du service",
    searchCode: "Nom du service",
    hint: "Tapez les premières lettres d'un service.",
    hintCode: "Tapez les premières lettres d'un service.",
    name: "Nom du service",
    unitHint: "",
    voidReasons: "Erreur de saisie|Erreur de prix|Séjour annulé|Service non rendu",
    item: "Service",
    newItem: "Nouvel extra",
    cost: "",
    opening: "",
  },
  transport: {
    search: "Nom",
    searchCode: "Nom",
    hint: "Tapez les premières lettres d'un nom.",
    hintCode: "Tapez les premières lettres d'un nom.",
    name: "Nom",
    unitHint: "",
    voidReasons: "Erreur de saisie|Erreur de prix|Voyage annulé|Billet remboursé",
    item: "Nom",
    newItem: "Nouveau",
    cost: "",
    opening: "",
  },
};

const ar: Words = {
  pharmacy: {
    search: "الاسم أو الاسم العلمي",
    searchCode: "الاسم أو الاسم العلمي أو الرمز الشريطي",
    hint: "اكتب الحروف الأولى من اسم الدواء أو اسمه العلمي.",
    hintCode: "اكتب الحروف الأولى من اسم الدواء، أو امسح علبته.",
    name: "الاسم التجاري",
    unitHint: "علبة، قارورة، أنبوب…",
    voidReasons: "إرجاع من الزبون|خطأ في الإدخال|خطأ في السعر|منتج تالف أو منتهي الصلاحية|وصفة ملغاة",
    item: "المنتج",
    newItem: "منتج جديد",
    cost: "سعر الشراء",
    opening: "الكمية على الرف اليوم",
  },
  shop: {
    search: "اسم المنتج",
    searchCode: "الاسم أو الرمز الشريطي",
    hint: "اكتب الحروف الأولى من اسم المنتج.",
    hintCode: "اكتب الحروف الأولى من اسم المنتج، أو امسح رمزه الشريطي.",
    name: "اسم المنتج",
    unitHint: "قطعة، كيلو، لتر، علبة…",
    voidReasons: "إرجاع من الزبون|خطأ في الإدخال|خطأ في السعر|منتج تالف",
    item: "المنتج",
    newItem: "منتج جديد",
    cost: "سعر الشراء",
    opening: "الكمية على الرف اليوم",
  },
  bakery: {
    search: "اسم المنتج",
    searchCode: "اسم المنتج",
    hint: "اكتب الحروف الأولى من اسم الخبز أو الحلوى.",
    hintCode: "اكتب الحروف الأولى من اسم الخبز أو الحلوى.",
    name: "اسم المنتج",
    unitHint: "قطعة، كيلو، صينية…",
    voidReasons: "خطأ في الإدخال|خطأ في السعر|منتج تالف|طلبية ملغاة",
    item: "المنتج",
    newItem: "منتج جديد",
    cost: "تكلفة الصنع",
    opening: "الكمية على الرف اليوم",
  },
  warehouse: {
    search: "اسم السلعة",
    searchCode: "الاسم أو المرجع أو الرمز الشريطي",
    hint: "اكتب الحروف الأولى من اسم السلعة.",
    hintCode: "اكتب الحروف الأولى من اسم السلعة، أو امسح رمزها.",
    name: "اسم السلعة",
    unitHint: "كرتون، كيس، قطعة، كيلو، لتر…",
    voidReasons: "إرجاع من الزبون|خطأ في الإدخال|خطأ في السعر|بضاعة تالفة",
    item: "السلعة",
    newItem: "سلعة جديدة",
    cost: "سعر الشراء",
    opening: "الكمية في المخزن اليوم",
  },
  general: {
    search: "اسم المنتج أو الخدمة",
    searchCode: "الاسم أو الرمز الشريطي",
    hint: "اكتب الحروف الأولى من اسم المنتج أو الخدمة.",
    hintCode: "اكتب الحروف الأولى من اسم المنتج أو الخدمة، أو امسح رمزه الشريطي.",
    name: "الاسم",
    unitHint: "قطعة، ساعة، كيلو…",
    voidReasons: "إرجاع من الزبون|خطأ في الإدخال|خطأ في السعر|خدمة ملغاة",
    item: "المنتج أو الخدمة",
    newItem: "إضافة منتج أو خدمة",
    cost: "سعر الشراء",
    opening: "الكمية على الرف اليوم",
  },
  restaurant: {
    search: "اسم الطبق",
    searchCode: "اسم الطبق",
    hint: "اكتب الحروف الأولى من اسم الطبق.",
    hintCode: "اكتب الحروف الأولى من اسم الطبق.",
    name: "اسم الطبق",
    unitHint: "",
    voidReasons: "خطأ في الإدخال|خطأ في السعر|طبق مرجع|طلب ملغى",
    item: "الطبق",
    newItem: "طبق جديد",
    cost: "",
    opening: "",
  },
  hotel: {
    search: "اسم الخدمة",
    searchCode: "اسم الخدمة",
    hint: "اكتب الحروف الأولى من اسم الخدمة.",
    hintCode: "اكتب الحروف الأولى من اسم الخدمة.",
    name: "اسم الخدمة",
    unitHint: "",
    voidReasons: "خطأ في الإدخال|خطأ في السعر|إقامة ملغاة|خدمة لم تقدم",
    item: "الخدمة",
    newItem: "إضافة جديدة",
    cost: "",
    opening: "",
  },
  transport: {
    search: "الاسم",
    searchCode: "الاسم",
    hint: "اكتب الحروف الأولى من الاسم.",
    hintCode: "اكتب الحروف الأولى من الاسم.",
    name: "الاسم",
    unitHint: "",
    voidReasons: "خطأ في الإدخال|خطأ في السعر|رحلة ملغاة|تذكرة مستردة",
    item: "الاسم",
    newItem: "جديد",
    cost: "",
    opening: "",
  },
};

const en: Words = {
  pharmacy: {
    search: "Name or generic name",
    searchCode: "Name, generic name or barcode",
    hint: "Type the first letters of a medicine or its generic name.",
    hintCode: "Type the first letters of a medicine, or scan its box.",
    name: "Brand name",
    unitHint: "Box, bottle, tube…",
    voidReasons: "Customer return|Typing mistake|Wrong price|Damaged or expired product|Prescription cancelled",
    item: "Product",
    newItem: "New product",
    cost: "Cost price",
    opening: "Quantity on the shelf today",
  },
  shop: {
    search: "Product name",
    searchCode: "Name or barcode",
    hint: "Type the first letters of a product.",
    hintCode: "Type the first letters of a product, or scan its barcode.",
    name: "Product name",
    unitHint: "Piece, kg, litre, pack…",
    voidReasons: "Customer return|Typing mistake|Wrong price|Damaged product",
    item: "Product",
    newItem: "New product",
    cost: "Cost price",
    opening: "Quantity on the shelf today",
  },
  bakery: {
    search: "Product name",
    searchCode: "Product name",
    hint: "Type the first letters of a bread or a pastry.",
    hintCode: "Type the first letters of a bread or a pastry.",
    name: "Product name",
    unitHint: "Piece, kg, tray…",
    voidReasons: "Typing mistake|Wrong price|Damaged product|Order cancelled",
    item: "Product",
    newItem: "New product",
    cost: "Cost to make",
    opening: "Quantity on the shelf today",
  },
  warehouse: {
    search: "Article name",
    searchCode: "Name, reference or barcode",
    hint: "Type the first letters of an article.",
    hintCode: "Type the first letters of an article, or scan its code.",
    name: "Article name",
    unitHint: "Case, bag, piece, kg, litre…",
    voidReasons: "Customer return|Typing mistake|Wrong price|Damaged goods",
    item: "Article",
    newItem: "New article",
    cost: "Cost price",
    opening: "Quantity in stock today",
  },
  general: {
    search: "Product or service name",
    searchCode: "Name or barcode",
    hint: "Type the first letters of a product or a service.",
    hintCode: "Type the first letters of a product or a service, or scan its barcode.",
    name: "Name",
    unitHint: "Piece, hour, kg…",
    voidReasons: "Customer return|Typing mistake|Wrong price|Service cancelled",
    item: "Product or service",
    newItem: "Add a product or a service",
    cost: "Cost price",
    opening: "Quantity on the shelf today",
  },
  restaurant: {
    search: "Dish name",
    searchCode: "Dish name",
    hint: "Type the first letters of a dish.",
    hintCode: "Type the first letters of a dish.",
    name: "Dish name",
    unitHint: "",
    voidReasons: "Typing mistake|Wrong price|Dish sent back|Order cancelled",
    item: "Dish",
    newItem: "New dish",
    cost: "",
    opening: "",
  },
  hotel: {
    search: "Service name",
    searchCode: "Service name",
    hint: "Type the first letters of a service.",
    hintCode: "Type the first letters of a service.",
    name: "Service name",
    unitHint: "",
    voidReasons: "Typing mistake|Wrong price|Stay cancelled|Service not given",
    item: "Service",
    newItem: "New extra",
    cost: "",
    opening: "",
  },
  transport: {
    search: "Name",
    searchCode: "Name",
    hint: "Type the first letters of a name.",
    hintCode: "Type the first letters of a name.",
    name: "Name",
    unitHint: "",
    voidReasons: "Typing mistake|Wrong price|Trip cancelled|Ticket refunded",
    item: "Name",
    newItem: "New",
    cost: "",
    opening: "",
  },
};

const all: Record<AppLanguage, Words> = { fr, ar, en };

/*
 * How this shop's products are handled, from what it said on the website:
 * which fields its product form has, and whether it finds them by barcode.
 */
export type ProductProfile = ProductWords & {
  /* Brand name and DCI: a pharmacy's. */
  genericName: boolean;
  /* Lots and expiry dates, with their counters on the stock screen. */
  batches: boolean;
  unit: boolean;
  barcode: boolean;
  /* A low-stock alert: not for bread baked every morning. */
  lowStock: boolean;
};

export function productProfile(configuration: Configuration): ProductProfile {
  const words = all[configuration.language.app]?.[configuration.pack] ?? fr[configuration.pack];
  const features = configuration.features;
  const codes = (() => {
    switch (configuration.pack) {
      case "pharmacy":
        return (features.pharmacy?.search ?? ["name", "barcode"]).includes("barcode");
      case "shop":
        return (features.shop?.search ?? ["name", "barcode"]).includes("barcode");
      case "warehouse":
        return true;
      case "general":
        return features.general?.trackStock !== false && (features.general?.sells ?? ["products"]).includes("products");
      default:
        return false;
    }
  })();
  const unit = (() => {
    switch (configuration.pack) {
      case "pharmacy":
      case "shop":
      case "warehouse":
        return true;
      case "bakery":
        /* Loaves are counted; only a baker who also sells by weight needs a unit. */
        return (features.bakery?.sellBy ?? ["piece"]).includes("weight");
      case "general":
        return (features.general?.sells ?? ["products"]).includes("products");
      default:
        return false;
    }
  })();
  return {
    ...words,
    search: codes ? words.searchCode : words.search,
    hint: codes ? words.hintCode : words.hint,
    genericName: configuration.pack === "pharmacy",
    batches: configuration.pack === "pharmacy" && features.pharmacy?.trackExpiry !== false,
    unit,
    barcode: codes,
    lowStock: configuration.pack !== "bakery",
  };
}

/* Every trade's "new" button, for the walks that open each trade's form. */
export function newItemLabels(language: AppLanguage): string[] {
  return [...new Set(Object.values(all[language]).map((words) => words.newItem))];
}
