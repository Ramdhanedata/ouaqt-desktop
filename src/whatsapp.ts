import type { AppLanguage } from "@app-ui/config";
import { formatQuantity } from "@app-ui/format";
import type { PrintedDay, Product } from "./bridge";

/*
 * A report as a WhatsApp message: the same page the screen, the printer and
 * the PDF show, written the way WhatsApp draws it. A star on each side makes
 * a word bold, a line of heavy dashes separates the parts, and a picture at
 * the start of a line says what it is about at a glance.
 *
 * The owner taps one button and WhatsApp opens with the message written; he
 * chooses who gets it there, himself, a partner or an accountant. Nothing is
 * sent by the app.
 */

const RULE = "━━━━━━━━━━━━━━";
/* WhatsApp's own limit is far higher; a link this long still opens everywhere. */
const LIMIT = 3500; // not-a-rule: what wa.me reliably carries

/* A star inside a name would open or close bold where it should not. */
const clean = (text: string) => text.replace(/[*_~`]/g, "").trim();

export type StockAlert = { name: string; left: string };

/* The products at or under their alert level, fewest first, as the message names them. */
export function stockAlerts(products: Product[], language: AppLanguage, max = 8): StockAlert[] {
  return products
    .filter((product) => product.lowStock !== null && product.onHand <= product.lowStock)
    .sort((a, b) => a.onHand - b.onHand)
    .slice(0, max)
    .map((product) => ({
      name: (language === "ar" && product.nameArabic) || product.name,
      left: `${formatQuantity(product.onHand, language)}${product.unit ? ` ${product.unit}` : ""}`,
    }));
}

export function whatsappText(
  report: PrintedDay,
  words: { shop: string; footer: string; stockHeading: string },
  alerts: StockAlert[] = []
): string {
  const lines: string[] = [];
  lines.push(`📊 *${clean(report.title)} — ${clean(words.shop)}*`);
  if (report.date) lines.push(clean(report.date));
  lines.push(RULE);
  lines.push(`💰 ${clean(report.totalLabel)} : *${report.total}*`);

  for (const section of report.sections) {
    if (section.rows.length === 0) continue;
    lines.push("");
    if (section.heading) lines.push(`📌 *${clean(section.heading)}*`);
    for (const row of section.rows) {
      const note = row.note ? ` (${clean(row.note)})` : "";
      /* A part of the row above (one app, one fund) sits under it, indented. */
      const part = /^\s*·\s*/.test(row.label);
      const name = clean(row.label.replace(/^\s*·\s*/, ""));
      lines.push(`${part ? "    ◦" : "•"} ${name} : *${clean(row.value)}*${note}`);
    }
  }

  if (alerts.length > 0) {
    lines.push("");
    lines.push(`⚠️ *${clean(words.stockHeading)}*`);
    for (const alert of alerts) lines.push(`• ${clean(alert.name)} : ${clean(alert.left)}`);
  }

  lines.push(RULE);
  lines.push(`_${clean(words.footer)}_`);

  const text = lines.join("\n");
  return text.length <= LIMIT ? text : `${text.slice(0, LIMIT - 1)}…`;
}
