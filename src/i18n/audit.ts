import type { AppLanguage } from "@app-ui/config";

/*
 * What each line of the log says, in the owner's words: "Vente annulée",
 * not "sale voided". Keyed by what the line is about and what was done to it.
 * A line this list does not know is shown by its own code rather than hidden.
 */

type Names = Record<string, string>;

const fr: Names = {
  "cash.opened": "Caisse ouverte",
  "cash.closed": "Caisse clôturée",
  "column.added": "Colonne ajoutée",
  "column.deleted": "Colonne supprimée",
  "customer.created": "Client créé",
  "customer.updated": "Client modifié",
  "customer.paid": "Dette payée",
  "dispatch.sent": "Bon de sortie",
  "order.cancelled": "Commande annulée",
  "order.line_cancelled_after_kitchen": "Plat retiré après la cuisine",
  "parcel.delivered": "Colis remis",
  "payment_app.added": "Application de paiement ajoutée",
  "payment_app.removed": "Application de paiement retirée",
  "payment_app.renamed": "Application de paiement renommée",
  "preorder.cancelled": "Commande annulée",
  "product.archived": "Produit retiré",
  "product.created": "Produit créé",
  "product.imported": "Produits importés",
  "product.received": "Réception",
  "product.transferred": "Transfert",
  "product.updated": "Produit modifié",
  "production.recorded": "Production",
  "production.unsold": "Invendus",
  "room.issue_reported": "Problème signalé",
  "room.issue_resolved": "Problème réglé",
  "sale.sold_past_expiry": "Vendu après péremption",
  "sale.voided": "Vente annulée",
  "stay.cancelled": "Réservation annulée",
  "stay.edited": "Séjour modifié",
};

const ar: Names = {
  "cash.opened": "فتح الصندوق",
  "cash.closed": "إغلاق الصندوق",
  "column.added": "إضافة عمود",
  "column.deleted": "حذف عمود",
  "customer.created": "إنشاء زبون",
  "customer.updated": "تعديل زبون",
  "customer.paid": "تسديد دين",
  "dispatch.sent": "وصل إخراج",
  "order.cancelled": "إلغاء طلب",
  "order.line_cancelled_after_kitchen": "سحب طبق بعد المطبخ",
  "parcel.delivered": "تسليم طرد",
  "payment_app.added": "إضافة تطبيق دفع",
  "payment_app.removed": "إزالة تطبيق دفع",
  "payment_app.renamed": "تغيير اسم تطبيق دفع",
  "preorder.cancelled": "إلغاء طلبية",
  "product.archived": "سحب منتج",
  "product.created": "إنشاء منتج",
  "product.imported": "استيراد منتجات",
  "product.received": "استلام",
  "product.transferred": "تحويل",
  "product.updated": "تعديل منتج",
  "production.recorded": "إنتاج",
  "production.unsold": "غير مبيع",
  "room.issue_reported": "الإبلاغ عن مشكلة",
  "room.issue_resolved": "حل مشكلة",
  "sale.sold_past_expiry": "بيع بعد انتهاء الصلاحية",
  "sale.voided": "إلغاء بيع",
  "stay.cancelled": "إلغاء حجز",
  "stay.edited": "تعديل إقامة",
};

const en: Names = {
  "cash.opened": "Till opened",
  "cash.closed": "Till closed",
  "column.added": "Column added",
  "column.deleted": "Column deleted",
  "customer.created": "Customer created",
  "customer.updated": "Customer changed",
  "customer.paid": "Debt paid",
  "dispatch.sent": "Delivery note",
  "order.cancelled": "Order cancelled",
  "order.line_cancelled_after_kitchen": "Dish taken off after the kitchen",
  "parcel.delivered": "Parcel handed over",
  "payment_app.added": "Payment app added",
  "payment_app.removed": "Payment app removed",
  "payment_app.renamed": "Payment app renamed",
  "preorder.cancelled": "Order cancelled",
  "product.archived": "Product removed",
  "product.created": "Product created",
  "product.imported": "Products imported",
  "product.received": "Goods received",
  "product.transferred": "Transfer",
  "product.updated": "Product changed",
  "production.recorded": "Production",
  "production.unsold": "Unsold",
  "room.issue_reported": "Problem reported",
  "room.issue_resolved": "Problem fixed",
  "sale.sold_past_expiry": "Sold past expiry",
  "sale.voided": "Sale voided",
  "stay.cancelled": "Booking cancelled",
  "stay.edited": "Stay changed",
};

const all: Record<AppLanguage, Names> = { fr, ar, en };

export function auditName(subject: string, action: string, language: AppLanguage): string {
  return all[language][`${subject}.${action}`] ?? all.fr[`${subject}.${action}`] ?? `${subject} ${action}`;
}
