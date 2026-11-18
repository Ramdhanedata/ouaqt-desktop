/* Receiving goods and counting the shelf, from a product's sheet. See stock.tsx. */

import { useState } from "react";
import { machine, type Product } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import { Choices, Confirm, Field, moneyText, parseMoney, parseQuantity } from "../ui";
import { lotText } from "./stock-shared";

export function ReceiveDialog({
  t,
  batches,
  lots,
  product,
  onDone,
}: {
  t: ScreensCopy;
  batches: boolean;
  /* The lot number too, for a pharmacy that notes them. */
  lots: boolean;
  product: Product;
  onDone: (ok: boolean | null, reason?: string) => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cost, setCost] = useState(moneyText(product.costPrice));
  const [supplier, setSupplier] = useState("");
  const parsed = parseQuantity(quantity);
  const costMinor = cost.trim() ? parseMoney(cost) : null;
  const valid = parsed !== null && parsed > 0 && (!cost.trim() || costMinor !== null);

  return (
    <Confirm
      title={t.receiveTitle}
      yes={t.save}
      no={t.cancel}
      onNo={() => onDone(null)}
      onYes={() => {
        if (!valid) return;
        void machine
          .receiveStock({
            productId: product.id,
            quantity: parsed as number,
            lot: lot || null,
            expiresOn: expiry || null,
            costPrice: costMinor,
            supplierName: supplier || null,
          })
          .then((answer) => onDone(answer.ok, answer.ok ? undefined : answer.reason));
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.quantity} value={quantity} onChange={setQuantity} kind="number" autoFocus error={quantity.trim() && !parsed ? t.badQuantity : null} />
        <Field label={t.costPrice} value={cost} onChange={setCost} kind="amount" error={cost.trim() && costMinor === null ? t.badAmount : null} />
        {lots ? <Field label={t.lot} value={lot} onChange={(value) => setLot(lotText(value))} ltr /> : null}
        {batches ? <Field label={t.expiryDate} value={expiry} onChange={setExpiry} kind="date" /> : null}
        <div className="col-span-2">
          <Field label={t.supplier} value={supplier} onChange={setSupplier} />
        </div>
      </div>
    </Confirm>
  );
}

export function CountDialog({
  t,
  product,
  onDone,
}: {
  t: ScreensCopy;
  product: Product;
  onDone: (ok: boolean | null, reason?: string) => void;
}) {
  const [counted, setCounted] = useState("");
  const reasons = [t.reasonCount, t.reasonBroken, t.reasonOther];
  const [reason, setReason] = useState(reasons[0]);
  const parsed = parseQuantity(counted);

  return (
    <Confirm
      title={t.countTitle}
      body={fill(t.countHint, { count: product.onHand })}
      yes={t.save}
      no={t.cancel}
      onNo={() => onDone(null)}
      onYes={() => {
        if (parsed === null) return;
        void machine
          .adjustStock({ productId: product.id, counted: parsed, reason: "adjustment", note: reason })
          .then((answer) => onDone(answer.ok, answer.ok ? undefined : answer.reason));
      }}
    >
      <div className="space-y-3">
        <Field label={t.counted} value={counted} onChange={setCounted} kind="number" autoFocus error={counted.trim() && parsed === null ? t.badQuantity : null} />
        <div>
          <div className="mb-1 text-base text-ink-2">{t.reason}</div>
          <Choices<string> value={reason} onChange={setReason} options={reasons.map((one) => ({ value: one, label: one }))} />
        </div>
      </div>
    </Confirm>
  );
}
