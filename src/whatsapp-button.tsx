import { useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type PrintedDay } from "./bridge";
import { icons } from "./icons";
import type { ScreensCopy } from "./i18n/screens";
import { stockAlerts, whatsappText } from "./whatsapp";

/*
 * The one green button: the report as a WhatsApp message, with the products
 * running low added at the end where the shop counts its stock. WhatsApp
 * opens with the text written; the owner chooses who gets it. The same
 * button, with the same words, at the end of the day and in Statistiques.
 */
export function WhatsappButton({
  configuration,
  t,
  report,
  wide,
  onSent,
}: {
  configuration: Configuration;
  t: ScreensCopy;
  report: PrintedDay | null;
  wide?: boolean;
  onSent?: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const language = configuration.language.app;
  const shop = (language === "ar" && configuration.business.nameArabic) || configuration.business.nameLatin;

  async function send() {
    if (!report || busy) return;
    setBusy(true);
    try {
      const products = await machine.products().catch(() => []);
      const text = whatsappText(report, { shop, footer: t.whatsappFooter, stockHeading: t.whatsappStock }, stockAlerts(products, language));
      await machine.openWhatsappText(text);
      onSent?.(t.whatsappOpened);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={!report || busy}
      onClick={() => void send()}
      className={`flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-whatsapp px-5 text-base font-semibold text-whatsapp-foreground shadow-card active:brightness-95 disabled:opacity-40 ${wide ? "w-full" : ""}`}
    >
      <icons.message size={20} />
      {t.sendWhatsapp}
    </button>
  );
}
