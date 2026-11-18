/* What the stock screen and its panels share: a product being typed in, its checks, the words for a movement. See stock.tsx. */

import { type MovementRow, type NewProduct, type Product } from "../bridge";
import { type ProductProfile } from "../i18n/products";
import { fill, type ScreensCopy } from "../i18n/screens";
import { moneyText, nameOr, parseMoney, parseQuantity } from "../ui";

/* A lot number takes letters and digits only, as the box prints it; anything else is not typed in. */
export const lotText = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 30);

/*
 * Two ways to show the same products. "stock" is the shelf: counts, batches,
 * receptions and corrections. "menu" is a restaurant's dishes or a hotel's
 * extras: names, categories and prices, sold without ever being counted.
 */
export type CatalogMode = {
  mode: "stock" | "menu";
  title?: string;
  newLabel?: string;
  /** The words for the switch that decides whether a product is counted. */
  trackLabel?: string;
  /** Batches and expiry dates, for a pharmacy. Set by the stock screen from the trade. */
  batches?: boolean;
  /** This trade's words and fields for a product (../i18n/products.ts). Set by the stock screen. */
  profile?: ProductProfile;
};

export type Draft = {
  name: string;
  genericName: string;
  nameArabic: string;
  category: string;
  unit: string;
  barcode: string;
  salePrice: string;
  costPrice: string;
  lowStock: string;
  tracked: boolean;
};

export function draftOf(product: Product | null): Draft {
  return {
    name: product?.name ?? "",
    genericName: product?.genericName ?? "",
    nameArabic: product?.nameArabic ?? "",
    category: product?.category ?? "",
    unit: product?.unit ?? "",
    barcode: product?.barcode ?? "",
    salePrice: moneyText(product?.salePrice),
    costPrice: moneyText(product?.costPrice),
    lowStock: product?.lowStock === null || product?.lowStock === undefined ? "" : String(product.lowStock),
    tracked: product ? product.tracked : true,
  };
}

/* The product's own description as fields, and whether each one reads. */
export function checkDraft(draft: Draft, t: ScreensCopy): { value: NewProduct | null; errors: Partial<Record<keyof Draft, string>> } {
  const errors: Partial<Record<keyof Draft, string>> = {};
  /* Nothing is required: an empty price is free, an empty name takes the next name given, or "No name". */
  const sale = draft.salePrice.trim() ? parseMoney(draft.salePrice) : 0;
  if (sale === null) errors.salePrice = t.badAmount;
  const cost = draft.costPrice.trim() ? parseMoney(draft.costPrice) : null;
  if (draft.costPrice.trim() && cost === null) errors.costPrice = t.badAmount;
  const low = draft.lowStock.trim() ? parseQuantity(draft.lowStock) : null;
  if (draft.lowStock.trim() && low === null) errors.lowStock = t.badQuantity;
  if (Object.keys(errors).length > 0) return { value: null, errors };
  return {
    value: {
      name: nameOr(t.noName, draft.name, draft.nameArabic, draft.genericName),
      genericName: draft.genericName,
      nameArabic: draft.nameArabic,
      category: draft.category,
      unit: draft.unit,
      barcode: draft.barcode,
      salePrice: sale as number,
      costPrice: cost,
      lowStock: low,
      tracked: draft.tracked,
    },
    errors,
  };
}

export type Tab = "details" | "batches" | "history";

export function movementLabel(move: MovementRow, t: ScreensCopy): string {
  switch (move.reason) {
    case "sale":
      return fill(t.moveSale, { number: move.saleNumber ?? "" });
    case "return":
      return t.moveReturn;
    case "reception":
      return move.opening ? t.moveOpening : t.moveReception;
    case "expiry":
      return t.moveExpiry;
    default:
      return t.moveAdjustment;
  }
}
