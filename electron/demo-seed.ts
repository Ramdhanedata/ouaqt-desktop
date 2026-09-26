import type Database from "better-sqlite3";
import type { Pack } from "@app-ui/packs";
import { recordProduction, createPreorder } from "./db/bakery";
import { addCashMovement } from "./db/cashbook";
import { addCustomer } from "./db/customers";
import { addCharge, addRoom, bookStay, setRoomStatus } from "./db/hotel";
import { addProduct, listProducts, receiveStock, today } from "./db/products";
import { addToOrder, sendToKitchen, startOrder } from "./db/restaurant";
import { recordSale } from "./db/sales";
import { addRoute, addVehicle, registerParcel, scheduleTrip, sellTicket } from "./db/transport";
import { ensureLocations } from "./db/warehouse";

/*
 * The invented shop each trade's demo opens on: products, a customer who
 * owes, a table already eating, a guest in a room, a bus half sold.
 *
 * Only the database is touched here, nothing on the disk and nothing of
 * Electron, so the same shop can be laid out in the desktop demo and in the
 * builder's preview, which runs this app in a web page.
 */

/*
 * The invented products for this trade, from the same sample list the
 * builder's preview draws. Only when the demo database is empty, so running
 * the demo twice does not double the stock.
 */
/*
 * A demo pharmacy: invented stock under real medicine names, with generic
 * names, costs and batches, one of them already expired and one expiring
 * within the alert window, so every screen has something true to show.
 */
const PHARMACY_DEMO = [
  // not-a-rule: invented demo stock, prices in minor units
  { name: "Doliprane 1000 mg", generic: "Paracétamol", ar: "دوليبران 1000", unit: "Boîte", price: 15000, cost: 9500, low: 10, lots: [{ lot: "DL2402", days: 400, qty: 40 }, { lot: "DL2311", days: -20, qty: 3 }] },
  { name: "Efferalgan 500 mg", generic: "Paracétamol", ar: "إيفيرالغان 500", unit: "Boîte", price: 12000, cost: 7800, low: 10, lots: [{ lot: "EF118", days: 300, qty: 25 }] },
  { name: "Amoxicilline 500 mg", generic: "Amoxicilline", ar: "أموكسيسيلين 500", unit: "Boîte", price: 18000, cost: 11000, low: 8, lots: [{ lot: "AMX77", days: 40, qty: 12 }] },
  { name: "Augmentin 1 g", generic: "Amoxicilline, acide clavulanique", ar: "أوغمنتين 1 غ", unit: "Boîte", price: 45000, cost: 32000, low: 5, lots: [{ lot: "AUG31", days: 500, qty: 6 }] },
  { name: "Spasfon", generic: "Phloroglucinol", ar: "سبازفون", unit: "Boîte", price: 9000, cost: 5500, low: 6, lots: [{ lot: "SP09", days: 250, qty: 4 }] },
  { name: "Smecta", generic: "Diosmectite", ar: "سمكتا", unit: "Boîte", price: 11000, cost: 7000, low: 5, lots: [{ lot: "SM55", days: 600, qty: 18 }] },
  { name: "Ventoline 100 µg", generic: "Salbutamol", ar: "فنتولين", unit: "Flacon", price: 25000, cost: 17000, low: 3, lots: [{ lot: "VT12", days: 700, qty: 7 }] },
  { name: "Voltarène gel", generic: "Diclofénac", ar: "فولتارين جل", unit: "Tube", price: 20000, cost: 13000, low: 4, lots: [{ lot: "VG40", days: 350, qty: 0 }] },
  { name: "Vitamine C 500 mg", generic: "Acide ascorbique", ar: "فيتامين سي 500", unit: "Boîte", price: 6000, cost: 3500, low: 10, lots: [{ lot: "VC88", days: 200, qty: 30 }] },
  { name: "Sérum physiologique", generic: "Chlorure de sodium", ar: "مصل فيزيولوجي", unit: "Boîte", price: 5000, cost: null, low: null, lots: [{ lot: "", days: 0, qty: 50 }] },
];

/*
 * The same pharmacy for the builder's preview, on the website, where nothing
 * may be read as advice about a medicine: counter items only, with the same
 * batches, one lot already past and one close to its date.
 */
const PHARMACY_COUNTER = [
  // not-a-rule: invented demo stock, prices in minor units
  { name: "Savon antiseptique", generic: null, ar: "صابون مطهر", unit: "Pièce", price: 12000, cost: 8000, low: 10, lots: [{ lot: "SA2408", days: 420, qty: 24 }] },
  { name: "Pansements, boîte", generic: null, ar: "لصقات، علبة", unit: "Boîte", price: 25000, cost: 16000, low: 5, lots: [{ lot: "PA2391", days: 40, qty: 4 }] },
  { name: "Gants, boîte de 50", generic: null, ar: "قفازات، علبة 50", unit: "Boîte", price: 40000, cost: 27000, low: 5, lots: [{ lot: "GA2502", days: 600, qty: 8 }] },
  { name: "Thermomètre", generic: null, ar: "ميزان حرارة", unit: "Pièce", price: 90000, cost: 60000, low: 3, lots: [{ lot: "", days: 0, qty: 3 }] },
  { name: "Coton hydrophile", generic: null, ar: "قطن طبي", unit: "Paquet", price: 15000, cost: 9000, low: 10, lots: [{ lot: "CO2317", days: 300, qty: 30 }, { lot: "CO2290", days: -20, qty: 2 }] },
  { name: "Masques, paquet", generic: null, ar: "كمامات، علبة", unit: "Paquet", price: 20000, cost: 12000, low: 10, lots: [{ lot: "MA2520", days: 800, qty: 40 }] },
  { name: "Gel hydroalcoolique", generic: null, ar: "جل معقم", unit: "Flacon", price: 18000, cost: 11000, low: 6, lots: [{ lot: "GH2440", days: 250, qty: 16 }] },
  { name: "Lingettes bébé", generic: null, ar: "مناديل أطفال", unit: "Paquet", price: 14000, cost: 9000, low: 6, lots: [{ lot: "LB2433", days: 330, qty: 12 }] },
];

function seedPharmacy(database: Database.Database, deviceId: string, stock: typeof PHARMACY_DEMO | typeof PHARMACY_COUNTER): void {
  const now = new Date();
  const inDays = (days: number) => today(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  for (const item of stock) {
    const id = addProduct(database, deviceId, {
      name: item.name,
      genericName: item.generic ?? undefined,
      nameArabic: item.ar,
      unit: item.unit,
      salePrice: item.price,
      costPrice: item.cost,
      lowStock: item.low,
    });
    for (const batch of item.lots) {
      if (batch.qty <= 0) continue;
      receiveStock(database, deviceId, {
        productId: id,
        quantity: batch.qty,
        lot: batch.lot || null,
        expiresOn: batch.lot ? inDays(batch.days) : null,
        costPrice: item.cost,
        supplierName: "Grossiste démo",
      });
    }
  }

  /* One customer who owes, so the Clients screen shows how a debt reads. */
  const customer = addCustomer(database, deviceId, { name: "Client démo", phone: "22 00 00 00" });
  const product = listProducts(database).find((one) => one.name.startsWith("Smecta") || one.name.startsWith("Masques"));
  if (product) {
    recordSale(database, deviceId, {
      payment: "credit",
      customerId: customer,
      lines: [{ productId: product.id, quantity: 2, unitPrice: product.salePrice }],
    });
  }
}

/* Invented stock for a trade, with the categories its screens group by. */
function seedCatalog(
  database: Database.Database,
  deviceId: string,
  items: { name: string; ar: string; price: number; category: string; unit?: string; qty?: number; tracked?: boolean; barcode?: string; locationId?: string }[]
): void {
  for (const item of items) {
    const id = addProduct(database, deviceId, {
      name: item.name,
      nameArabic: item.ar,
      salePrice: item.price,
      category: item.category,
      unit: item.unit,
      barcode: item.barcode,
      lowStock: item.tracked === false ? null : 5,
      tracked: item.tracked !== false,
      costPrice: item.tracked === false ? null : Math.round(item.price * 0.7),
    });
    if (item.tracked !== false && item.qty) {
      receiveStock(database, deviceId, { productId: id, quantity: item.qty, locationId: item.locationId ?? null, supplierName: "Grossiste démo" });
    }
  }
}

function seedTrade(database: Database.Database, deviceId: string, pack: Pack): void {
  const now = new Date();
  const at = (days: number, hours: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hours, 0).toISOString();
  switch (pack) {
    case "shop":
      seedCatalog(database, deviceId, [
        { name: "Lait en poudre 400 g", ar: "حليب مجفف 400 غ", price: 18000, category: "Épicerie", unit: "Boîte", qty: 24, barcode: "6111000000001" },
        { name: "Sucre", ar: "سكر", price: 4500, category: "Épicerie", unit: "kg", qty: 50 },
        { name: "Huile 1 litre", ar: "زيت 1 لتر", price: 9000, category: "Épicerie", unit: "Bouteille", qty: 36 },
        { name: "Thé vert", ar: "شاي أخضر", price: 12000, category: "Épicerie", unit: "Paquet", qty: 3 },
        { name: "Savon", ar: "صابون", price: 3000, category: "Hygiène", unit: "Pièce", qty: 60 },
        { name: "Recharge téléphone", ar: "تعبئة رصيد", price: 10000, category: "Services", tracked: false },
      ]);
      return;
    case "general":
      seedCatalog(database, deviceId, [
        { name: "Coupe de cheveux", ar: "قص الشعر", price: 30000, category: "Services", tracked: false },
        { name: "Réparation", ar: "إصلاح", price: 50000, category: "Services", tracked: false },
        { name: "Shampooing", ar: "شامبو", price: 25000, category: "Produits", unit: "Flacon", qty: 12 },
        { name: "Câble de chargeur", ar: "سلك شاحن", price: 15000, category: "Produits", unit: "Pièce", qty: 3 },
      ]);
      addCashMovement(database, deviceId, { direction: "out", amount: 150000, reason: "expense", category: "Loyer" });
      return;
    case "restaurant":
      seedCatalog(database, deviceId, [
        { name: "Thé à la menthe", ar: "شاي بالنعناع", price: 5000, category: "Boissons", tracked: false },
        { name: "Café", ar: "قهوة", price: 8000, category: "Boissons", tracked: false },
        { name: "Jus d'orange", ar: "عصير برتقال", price: 12000, category: "Boissons", tracked: false },
        { name: "Thiéboudiène", ar: "تيبودين", price: 60000, category: "Plats", tracked: false },
        { name: "Poulet grillé", ar: "دجاج مشوي", price: 70000, category: "Plats", tracked: false },
        { name: "Sandwich viande", ar: "سندويتش لحم", price: 25000, category: "Sandwichs", tracked: false },
      ]);
      {
        const order = startOrder(database, deviceId, { service: "dine_in", tableNo: 3, guests: 2 });
        const tea = listProducts(database).find((one) => one.name.startsWith("Thé"));
        const dish = listProducts(database).find((one) => one.name.startsWith("Thiéboudiène"));
        if (tea && dish) {
          addToOrder(database, deviceId, { orderId: order, productId: dish.id, quantity: 2 });
          addToOrder(database, deviceId, { orderId: order, productId: tea.id, quantity: 2 });
          sendToKitchen(database, order);
        }
      }
      return;
    case "bakery":
      seedCatalog(database, deviceId, [
        { name: "Pain", ar: "خبز", price: 2000, category: "Pains", unit: "Pièce" },
        { name: "Baguette", ar: "باغيت", price: 2500, category: "Pains", unit: "Pièce" },
        { name: "Croissant", ar: "كرواسون", price: 5000, category: "Viennoiseries", unit: "Pièce" },
        { name: "Gâteau, part", ar: "قطعة كعك", price: 15000, category: "Pâtisseries", unit: "Pièce" },
      ]);
      recordProduction(
        database,
        deviceId,
        listProducts(database).map((product) => ({ productId: product.id, quantity: product.name === "Pain" ? 200 : 40 }))
      );
      {
        const cake = listProducts(database).find((one) => one.name.startsWith("Gâteau"));
        if (cake) {
          createPreorder(database, deviceId, {
            customer: "Client commande",
            phone: "22 11 11 11",
            dueOn: today(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)),
            lines: [{ productId: cake.id, quantity: 8, unitPrice: cake.salePrice }],
            deposit: 50000,
          });
        }
      }
      return;
    case "warehouse": {
      const [first, second] = ensureLocations(database, deviceId, ["Dépôt principal", "Magasin 2"]);
      seedCatalog(database, deviceId, [
        { name: "Sac de riz 50 kg", ar: "كيس أرز 50 كغ", price: 1200000, category: "Riz", unit: "Sac", qty: 60, locationId: first.id },
        { name: "Carton d'huile", ar: "كرتون زيت", price: 900000, category: "Huile", unit: "Carton", qty: 45, locationId: first.id },
        { name: "Sac de sucre 25 kg", ar: "كيس سكر 25 كغ", price: 750000, category: "Sucre", unit: "Sac", qty: 30, locationId: second?.id ?? first.id },
      ]);
      return;
    }
    case "hotel": {
      const rooms = ["101", "102", "103", "104", "201", "202", "203", "204"].map((number, index) =>
        addRoom(database, deviceId, { number, kind: index % 2 ? "Double" : "Simple", rate: index % 2 ? 250000 : 180000 })
      );
      seedCatalog(database, deviceId, [
        { name: "Petit-déjeuner", ar: "فطور", price: 25000, category: "Repas", tracked: false },
        { name: "Dîner", ar: "عشاء", price: 60000, category: "Repas", tracked: false },
        { name: "Blanchisserie", ar: "غسيل", price: 20000, category: "Services", tracked: false },
        { name: "Eau minérale", ar: "ماء معدني", price: 5000, category: "Boissons", tracked: false },
      ]);
      const stay = bookStay(database, deviceId, {
        roomId: rooms[1],
        guest: "Client hôtel",
        phone: "22 33 33 33",
        idDocument: "NNI 0000000000",
        arrivesOn: today(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)),
        leavesOn: today(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)),
        advance: 100000,
        checkInNow: true,
      });
      addCharge(database, deviceId, { stayId: stay, label: "Petit-déjeuner", unitPrice: 25000 });
      bookStay(database, deviceId, {
        roomId: rooms[4],
        guest: "Client réservation",
        arrivesOn: today(now),
        leavesOn: today(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3)),
      });
      setRoomStatus(database, rooms[2], "cleaning");
      return;
    }
    case "transport": {
      const route = addRoute(database, deviceId, { origin: "Nouakchott", destination: "Nouadhibou", fare: 80000, parcelFee: 20000 });
      const second = addRoute(database, deviceId, { origin: "Nouakchott", destination: "Rosso", fare: 30000, parcelFee: 10000 });
      const bus = addVehicle(database, deviceId, { plate: "0000-AA-00", seats: 18 });
      const van = addVehicle(database, deviceId, { plate: "1111-BB-11", seats: 12 });
      const morning = scheduleTrip(database, deviceId, { routeId: route, vehicleId: bus, driver: "Chauffeur démo", departsAt: at(0, 8) });
      scheduleTrip(database, deviceId, { routeId: second, vehicleId: van, driver: "Chauffeur démo", departsAt: at(0, 14) });
      scheduleTrip(database, deviceId, { routeId: route, vehicleId: bus, driver: "Chauffeur démo", departsAt: at(1, 8) });
      const label = (trip: { origin: string; destination: string }, seat: number | null) => `${trip.origin} → ${trip.destination}, place ${seat ?? "-"}`;
      sellTicket(database, deviceId, { tripId: morning, seat: 1, passenger: "Voyageur démo", phone: "22 44 44 44", payment: { payment: "cash" }, label });
      sellTicket(database, deviceId, { tripId: morning, seat: 2, passenger: "Voyageuse démo", payment: { payment: "mobile", mobileApp: "Bankily" }, label });
      registerParcel(database, deviceId, {
        routeId: route,
        tripId: morning,
        sender: "Expéditeur démo",
        receiver: "Destinataire démo",
        receiverPhone: "22 55 55 55",
        description: "Carton de vêtements",
        fee: 20000,
        paidBy: "receiver",
        label: (code) => `Colis ${code}`,
      });
      return;
    }
    default:
      return;
  }
}

export function seedDemo(
  database: Database.Database,
  deviceId: string,
  pack: Pack,
  options: { empty?: boolean; counterItems?: boolean } = {}
): void {
  /* An empty shop, as on the first day, to see the screens before anything is added. */
  if (options.empty) return;
  if (listProducts(database).length > 0) return;
  if (pack === "pharmacy") {
    seedPharmacy(database, deviceId, options.counterItems ? PHARMACY_COUNTER : PHARMACY_DEMO);
    return;
  }
  if (pack !== "restaurant" && pack !== "bakery" && pack !== "warehouse" && pack !== "hotel" && pack !== "transport" && pack !== "shop" && pack !== "general") {
    return;
  }
  seedTrade(database, deviceId, pack);
}

