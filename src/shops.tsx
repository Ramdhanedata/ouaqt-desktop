import { useEffect, useState } from "react";
import type { AppLanguage } from "@app-ui/config";
import { machine, type ShopOnComputer } from "./bridge";
import { copyFor, tradeName } from "./i18n";
import type { ScreensCopy } from "./i18n/screens";
import { Button, Notice } from "./ui";

/*
 * The shops this computer holds, and the way to open another.
 *
 * Each keeps its own sales, stock and customers in its own folder; opening
 * one changes nothing in the others. A shop not on the computer yet is
 * opened by its link, or by downloading it again: the software asks whether
 * to open it, as it does for any download (2026-11-17: no serial to type).
 */
export function ShopsSettings({ t, language }: { t: ScreensCopy; language: AppLanguage }) {
  const [shops, setShops] = useState<ShopOnComputer[]>([]);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const copy = copyFor(language);

  useEffect(() => {
    void machine.shopsOnComputer().then(setShops);
  }, []);

  return (
    <section>
      <h2 className="text-xl font-semibold">{t.shopsSection}</h2>
      <p className="mt-1 text-base text-ink-3">{t.shopsNote}</p>
      {shops.length > 1 ? (
        <ul className="mt-3 divide-y divide-line rounded-lg border-2 border-line">
          {shops.map((shop) => (
            <li key={shop.businessId} className="flex min-h-[64px] items-center justify-between gap-3 px-4 py-2 text-base">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{(language === "ar" && shop.nameArabic) || shop.name || shop.businessId}</span>
                <span className="block text-ink-3">{tradeName(shop.pack, copy)}</span>
              </span>
              {shop.open ? (
                <span className="shrink-0 font-semibold">{t.shopOpenNow}</span>
              ) : (
                <Button
                  onClick={() =>
                    void machine.switchShop(shop.businessId).then((opened) => {
                      if (!opened) setNote({ text: t.shopNotOpened, kind: "problem" });
                    })
                  }
                >
                  {t.shopOpen}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {/* Another shop opens like the first one did: its link opened on this computer, or downloaded again from the website. */}
      <p className="mt-3 max-w-xl text-base text-ink-2">{t.otherShopHow}</p>
      {note ? (
        <div className="mt-3">
          <Notice kind={note.kind} text={note.text} />
        </div>
      ) : null}
    </section>
  );
}
