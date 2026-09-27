import { useState } from "react";
import { machine, type OtherShopOffer, type UiLanguage } from "./bridge";
import { messageFor } from "./activation";
import { copyFor, tradeName } from "./i18n";
import { fill, screensFor } from "./i18n/screens";
import { Confirm, Notice } from "./ui";

/*
 * Another shop than the open one, and the owner asked whether to open it.
 *
 * He downloaded his pharmacy on the website, or pressed its link, or typed
 * its serial, on a computer that has been opening his hotel. The software he
 * asked for is the one he gets: one tap and the pharmacy opens. The hotel
 * stays on the computer, whole, and Settings opens it again. Nothing
 * changes until he answers, and "no" changes nothing at all.
 */
export function OtherShopQuestion({
  offer,
  language,
  onDone,
}: {
  offer: OtherShopOffer;
  language: UiLanguage;
  onDone: () => void;
}) {
  const copy = copyFor(language);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const name = (language === "ar" && offer.shop.nameArabic) || offer.shop.name;
  const current = offer.current ? (language === "ar" && offer.current.nameArabic) || offer.current.name : null;
  const body =
    offer.current && current
      ? fill(copy.otherShopBody, {
          name,
          trade: tradeName(offer.shop.pack, copy),
          current,
          currentTrade: tradeName(offer.current.pack, copy),
        })
      : fill(copy.otherShopBodyAlone, { name, trade: tradeName(offer.shop.pack, copy) });

  async function open() {
    /* A refusal already said is read, then closed: the open shop is where it was. */
    if (problem) return onDone();
    if (busy) return;
    setBusy(true);
    const result = await machine.openPendingShop();
    /* On success the window reloads on the new shop; there is nothing more to do here. */
    if (!result.ok) {
      setBusy(false);
      setProblem(messageFor(result, copy));
    }
  }

  return (
    <Confirm
      title={fill(copy.otherShopTitle, { name })}
      body={body}
      yes={problem ? screensFor(language).close : busy ? fill(copy.otherShopOpening, { name }) : fill(copy.otherShopOpen, { name })}
      no={current ? fill(copy.otherShopStay, { current }) : copy.otherShopStayAlone}
      onYes={() => void open()}
      onNo={() => {
        void machine.stayOnShop();
        onDone();
      }}
    >
      {problem ? <Notice kind="problem" text={problem} /> : null}
    </Confirm>
  );
}
