import { useEffect, useState } from "react";
import type { AppLanguage } from "@app-ui/config";
import { machine, type ShopOnComputer } from "./bridge";
import { messageFor } from "./activation";
import { copyFor, tradeName } from "./i18n";
import type { ScreensCopy } from "./i18n/screens";
import { Button, Field, Notice } from "./ui";

/*
 * The shops this computer holds, and the way to open another.
 *
 * Each keeps its own sales, stock and customers in its own folder; opening
 * one changes nothing in the others. A shop not on the computer yet is
 * opened with its serial, after the same question the download asks.
 */
export function ShopsSettings({ t, language }: { t: ScreensCopy; language: AppLanguage }) {
  const [shops, setShops] = useState<ShopOnComputer[]>([]);
  const [serial, setSerial] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const copy = copyFor(language);

  useEffect(() => {
    void machine.shopsOnComputer().then(setShops);
  }, []);

  async function bySerial() {
    if (!serial.trim() || busy) return;
    setBusy(true);
    setNote(null);
    const result = await machine.openShopBySerial(serial);
    setBusy(false);
    /* Another shop's serial: the question opens over this screen. The same shop: brought up to date. */
    if (result.ok) setNote({ text: t.shopAlreadyOpen, kind: "done" });
    else if (result.error !== "asked") setNote({ text: messageFor(result, copy), kind: "problem" });
  }

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
      <div className="mt-3 flex max-w-xl items-end gap-3">
        <div className="min-w-0 flex-1">
          <Field label={t.otherSerial} value={serial} onChange={setSerial} ltr onEnter={() => void bySerial()} />
        </div>
        <Button disabled={!serial.trim() || busy} onClick={() => void bySerial()}>
          {t.otherSerialGo}
        </Button>
      </div>
      {note ? (
        <div className="mt-3">
          <Notice kind={note.kind} text={note.text} />
        </div>
      ) : null}
    </section>
  );
}
