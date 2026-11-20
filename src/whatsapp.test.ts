import { describe, expect, it } from "vitest";
import type { PrintedDay } from "./bridge";
import { whatsappText } from "./whatsapp";

const page: PrintedDay = {
  title: "Fin de journée",
  date: "vendredi 20 novembre 2026",
  totalLabel: "Revenu total",
  total: "640,00 MRU",
  sections: [
    { rows: [{ label: "Nombre de ventes", value: "2" }] },
    {
      heading: "Paiements",
      rows: [
        { label: "Application", value: "400,00 MRU" },
        { label: "· Bankily", value: "400,00 MRU" },
      ],
    },
    { heading: "Vide", rows: [] },
  ],
};

describe("the WhatsApp report", () => {
  const text = whatsappText(page, { shop: "Pharmacie *Essai*", footer: "Envoyé depuis OUAQT", stockHeading: "Stock" }, [{ name: "Gants", left: "4" }]);

  it("puts the shop, the date and the total first, in bold", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("📊 *Fin de journée — Pharmacie Essai*");
    expect(lines[1]).toBe("vendredi 20 novembre 2026");
    expect(text).toContain("💰 Revenu total : *640,00 MRU*");
  });

  it("writes each row once, an app under its payment, and skips empty parts", () => {
    expect(text).toContain("• Nombre de ventes : *2*");
    expect(text).toContain("    ◦ Bankily : *400,00 MRU*");
    expect(text).not.toContain("Vide");
  });

  it("adds the products running low and ends with the footer", () => {
    expect(text).toContain("⚠️ *Stock*\n• Gants : 4");
    expect(text.trim().endsWith("_Envoyé depuis OUAQT_")).toBe(true);
  });
});
