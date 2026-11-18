/*
 * A product of the stock screen: the fields it is made with, the panel that
 * makes a new one and the sheet of one already there. See stock.tsx.
 */

import { useCallback, useEffect, useState } from "react";
import type { AppLanguage } from "@app-ui/config";
import { machine, type Batch, type MovementRow, type Product } from "../bridge";
import { CustomFields, saveCustomFields, useListShape } from "../columns";
import { fill, type ScreensCopy } from "../i18n/screens";
import { icons } from "../icons";
import { Button, Choices, Confirm, Field, Notice, Panel, Toggle, day, localDay, parseQuantity, when } from "../ui";
import { checkDraft, draftOf, lotText, movementLabel, type CatalogMode, type Draft, type Tab } from "./stock-shared";
import { CountDialog, ReceiveDialog } from "./stock-dialogs";

function ProductFields({
  draft,
  setDraft,
  errors,
  t,
  catalog,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  errors: Partial<Record<keyof Draft, string>>;
  t: ScreensCopy;
  catalog: CatalogMode;
}) {
  const set = (key: Exclude<keyof Draft, "tracked">) => (value: string) => setDraft({ ...draft, [key]: value });
  const menu = catalog.mode === "menu";
  /* What most products need is three fields; the rest waits behind one button, and opens by itself to show a mistake. */
  const [more, setMore] = useState(false);
  const open = more || Boolean(errors.costPrice || errors.lowStock);
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Field label={catalog.profile?.name ?? t.name} value={draft.name} onChange={set("name")} error={errors.name} autoFocus />
      </div>
      {/* A pharmacy finds and prints a medicine by its generic name too, so it stays beside the name. */}
      {catalog.profile?.genericName ? (
        <div className="col-span-2">
          <Field label={t.genericName} value={draft.genericName} onChange={set("genericName")} />
        </div>
      ) : null}
      {/* A dish or a hotel's service has a price and nothing else to fill in. */}
      <Field label={catalog.profile?.cost === "" ? t.colPrice : t.salePrice} value={draft.salePrice} onChange={set("salePrice")} kind="amount" error={errors.salePrice} />
      <Field label={t.category} value={draft.category} onChange={set("category")} />
      <div className="col-span-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setMore(!open)}
          className="flex min-h-[48px] items-center gap-2 text-base font-semibold text-ink-2 underline underline-offset-4"
        >
          {open ? <icons.up size={20} /> : <icons.down size={20} />}
          {open ? t.fewerDetails : t.moreDetails}
        </button>
      </div>
      {open ? (
        <>
          <Field label={t.nameArabic} value={draft.nameArabic} onChange={set("nameArabic")} />
          {!menu && catalog.profile?.unit !== false ? (
            <Field label={t.unit} value={draft.unit} onChange={set("unit")} hint={catalog.profile?.unitHint || t.unitHint} />
          ) : null}
          {catalog.profile?.cost !== "" ? (
            <Field label={catalog.profile?.cost ?? t.costPrice} value={draft.costPrice} onChange={set("costPrice")} kind="amount" error={errors.costPrice} />
          ) : null}
          {!menu && draft.tracked && catalog.profile?.lowStock !== false ? (
            <Field label={t.lowStockAt} value={draft.lowStock} onChange={set("lowStock")} kind="number" hint={t.lowStockHint} error={errors.lowStock} />
          ) : null}
          {!menu && catalog.profile?.barcode !== false ? <Field label={t.barcode} value={draft.barcode} onChange={set("barcode")} ltr /> : null}
          {catalog.trackLabel ? (
            <div className="col-span-2">
              <Toggle label={catalog.trackLabel} checked={draft.tracked} onChange={(tracked) => setDraft({ ...draft, tracked })} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function NewProductPanel({
  t,
  catalog,
  onClose,
  onCreated,
}: {
  t: ScreensCopy;
  catalog: CatalogMode;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const menu = catalog.mode === "menu";
  const [draft, setDraft] = useState<Draft>({ ...draftOf(null), tracked: !menu });
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [opening, setOpening] = useState("");
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { shape } = useListShape("products");
  const [custom, setCustom] = useState<Record<string, string>>({});

  async function save() {
    const checked = checkDraft(draft, t);
    setErrors(checked.errors);
    const quantity = opening.trim() ? parseQuantity(opening) : null;
    if (!checked.value || (opening.trim() && quantity === null)) return;
    setBusy(true);
    const added = await machine.addProduct(checked.value);
    if (!added.ok) {
      setBusy(false);
      setProblem(added.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    if (quantity !== null && quantity > 0) {
      await machine.receiveStock({
        productId: added.value,
        quantity,
        lot: lot || null,
        expiresOn: expiry || null,
        costPrice: checked.value.costPrice ?? null,
      });
    }
    /* The product exists now; a value of his own that is refused is said on its sheet, which opens next. */
    await saveCustomFields("products", added.value, t, {}, custom);
    setBusy(false);
    onCreated(added.value);
  }

  return (
    <Panel
      title={catalog.newLabel ?? catalog.profile?.newItem ?? t.newProduct}
      onClose={onClose}
      closeLabel={t.close}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t.cancel}</Button>
          <Button kind="primary" disabled={busy} onClick={() => void save()}>
            {t.save}
          </Button>
        </div>
      }
    >
      <ProductFields draft={draft} setDraft={setDraft} errors={errors} t={t} catalog={catalog} />
      {/* Stock on the shelf is entered with Receive, after; only a pharmacy names its first lot and expiry here. */}
      {!menu && draft.tracked && (catalog.batches || catalog.profile?.lots) ? (
        <div className="mt-5 grid grid-cols-3 max-md:grid-cols-2 gap-3 border-t border-line pt-5">
          <Field label={catalog.profile?.opening || t.openingStock} value={opening} onChange={setOpening} kind="number" error={opening.trim() && parseQuantity(opening) === null ? t.badQuantity : null} />
          {catalog.profile?.lots ? <Field label={t.lot} value={lot} onChange={(value) => setLot(lotText(value))} ltr /> : null}
          {catalog.batches ? <Field label={t.expiryDate} value={expiry} onChange={setExpiry} kind="date" /> : null}
        </div>
      ) : null}
      <CustomFields
        t={t}
        columns={shape?.columns ?? []}
        values={custom}
        errors={{}}
        onChange={(column, value) => setCustom((current) => ({ ...current, [column]: value }))}
      />
      {problem ? <div className="mt-4"><Notice kind="problem" text={problem} /></div> : null}
    </Panel>
  );
}

export function ProductPanel({
  id,
  t,
  catalog,
  language,
  readOnly,
  expiredIds,
  onClose,
  onChanged,
}: {
  id: string;
  t: ScreensCopy;
  catalog: CatalogMode;
  language: AppLanguage;
  readOnly: boolean;
  expiredIds: Set<string>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [draft, setDraft] = useState<Draft>(draftOf(null));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [tab, setTab] = useState<Tab>("details");
  const [action, setAction] = useState<"receive" | "count" | null>(null);
  const [writeOff, setWriteOff] = useState<Batch | null>(null);
  const [archiving, setArchiving] = useState(false);
  /* A line of the stock history entered by mistake, about to go. */
  const [removing, setRemoving] = useState<MovementRow | null>(null);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const { shape, reload: reloadCustom } = useListShape("products");
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (shape) setCustom(shape.values[id] ?? {});
  }, [shape, id]);

  const load = useCallback(() => {
    void machine.productDetail(id).then((answer) => {
      if (!answer.ok) return;
      setProduct(answer.value.product);
      setBatches(answer.value.batches);
      setMovements(answer.value.movements);
      setDraft(draftOf(answer.value.product));
    });
  }, [id]);

  useEffect(load, [load]);

  const after = (ok: boolean, reason?: string) => {
    if (ok) {
      setNote({ text: t.saved, kind: "done" });
      load();
      onChanged();
    } else {
      setNote({ text: reason === "read_only" ? t.readOnly : t.notSaved, kind: "problem" });
    }
  };

  async function saveDetails() {
    const checked = checkDraft(draft, t);
    setErrors(checked.errors);
    if (!checked.value) return;
    const answer = await machine.updateProduct(id, checked.value);
    if (!answer.ok) return after(false, answer.reason);
    const refused = await saveCustomFields("products", id, t, shape?.values[id] ?? {}, custom);
    setCustomErrors(refused);
    reloadCustom();
    if (Object.keys(refused).length === 0) return after(true);
    setNote({ text: t.valueNotSaved, kind: "problem" });
    load();
    onChanged();
  }

  if (!product) return null;
  const today = localDay();
  const counted = catalog.mode !== "menu" && product.tracked;

  return (
    <Panel
      title={product.name}
      onClose={onClose}
      closeLabel={t.close}
      footer={
        tab === "details" ? (
          <div className="flex items-center justify-between gap-2">
            <Button kind="quiet" disabled={readOnly} onClick={() => setArchiving(true)}>
              {t.archive}
            </Button>
            <Button kind="primary" disabled={readOnly} onClick={() => void saveDetails()}>
              {t.save}
            </Button>
          </div>
        ) : null
      }
    >
      {counted ? (
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-base text-ink-3">{t.colStock}</div>
          <div className="text-4xl font-bold">
            <bdi>{product.onHand}</bdi>
            {product.unit ? <span className="ms-2 text-xl font-normal text-ink-3">{product.unit}</span> : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Button disabled={readOnly} onClick={() => setAction("count")}>
            {t.count}
          </Button>
          <Button kind="primary" disabled={readOnly} onClick={() => setAction("receive")}>
            {t.receive}
          </Button>
        </div>
      </div>
      ) : null}
      {expiredIds.has(product.id) ? <div className="mt-3"><Notice kind="problem" text={t.expiredOnShelf} /></div> : null}

      {counted ? (
        <div className="mt-5">
          <Choices<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "details", label: t.details },
              ...(catalog.batches ? [{ value: "batches" as const, label: t.batches, count: batches.length }] : []),
              { value: "history", label: t.history },
            ]}
          />
        </div>
      ) : null}

      {note ? <div className="mt-4"><Notice kind={note.kind} text={note.text} /></div> : null}

      <div className="mt-5">
        {tab === "details" ? (
          <>
            <ProductFields draft={draft} setDraft={setDraft} errors={errors} t={t} catalog={catalog} />
            <CustomFields
              t={t}
              columns={shape?.columns ?? []}
              values={custom}
              errors={customErrors}
              onChange={(column, value) => setCustom((current) => ({ ...current, [column]: value }))}
            />
          </>
        ) : null}

        {tab === "batches" ? (
          batches.length === 0 ? (
            <p className="text-base text-ink-3">{t.noBatches}</p>
          ) : (
            <div className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4">
              <table className="w-full text-base max-md:w-max max-md:min-w-full max-md:[&_td]:pe-4 max-md:[&_th]:pe-4">
                <thead>
                  <tr className="border-b-2 border-line text-ink-3">
                    <th className="py-2 text-start font-normal">{t.lot}</th>
                    <th className="py-2 text-start font-normal">{t.colExpiry}</th>
                    <th className="py-2 text-end font-normal">{t.remaining}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => {
                    const isExpired = batch.expiresOn !== null && batch.expiresOn < today;
                    return (
                      <tr key={batch.id} className="border-b border-line">
                        <td className="py-3"><bdi>{batch.lot ?? ""}</bdi></td>
                        <td className={`py-3 ${isExpired ? "font-bold" : ""}`}>
                          {day(batch.expiresOn, language)}
                          {isExpired ? ` · ${t.expiredOnShelf}` : ""}
                        </td>
                        <td className="py-3 text-end"><bdi>{batch.remaining}</bdi></td>
                        <td className="py-3 text-end">
                          <Button kind={isExpired ? "danger" : "quiet"} disabled={readOnly} onClick={() => setWriteOff(batch)}>
                            {t.writeOff}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "history" ? (
          movements.length === 0 ? (
            <p className="text-base text-ink-3">{t.noHistory}</p>
          ) : (
            <ul>
              {movements.map((move) => (
                <li key={move.id} className="flex items-center justify-between gap-3 border-b border-line py-3">
                  <span>
                    <span className="block text-base">{movementLabel(move, t)}</span>
                    <span className="block text-base text-ink-3">
                      <bdi>{when(move.occurredAt, language)}</bdi>
                      {move.lot ? <> · {t.lot} <bdi>{move.lot}</bdi></> : null}
                      {move.reference ? ` · ${move.reference}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <bdi className="text-lg font-semibold">{move.quantity > 0 ? `+${move.quantity}` : move.quantity}</bdi>
                    <Button kind="quiet" disabled={readOnly} onClick={() => setRemoving(move)}>
                      {t.deleteLine}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      {removing ? (
        <Confirm
          title={removing.saleNumber !== null ? fill(t.deleteSaleTitle, { number: removing.saleNumber }) : t.deleteLineTitle}
          body={removing.saleNumber !== null ? t.deleteSaleLineBody : t.deleteMovementBody}
          yes={t.deleteLine}
          no={t.cancel}
          onNo={() => setRemoving(null)}
          onYes={() => {
            const moveId = removing.id;
            setRemoving(null);
            void machine.deleteStockMovement(moveId).then((answer) => {
              setNote(answer.ok ? { text: t.deleteDone, kind: "done" } : { text: answer.reason === "read_only" ? t.readOnly : t.notSaved, kind: "problem" });
              load();
              onChanged();
            });
          }}
        />
      ) : null}
      {action === "receive" ? (
        <ReceiveDialog
          t={t}
          batches={Boolean(catalog.batches)}
          lots={Boolean(catalog.profile?.lots)}
          product={product}
          onDone={(ok, reason) => {
            setAction(null);
            if (ok !== null) after(ok, reason);
          }}
        />
      ) : null}
      {action === "count" ? (
        <CountDialog
          t={t}
          product={product}
          onDone={(ok, reason) => {
            setAction(null);
            if (ok !== null) after(ok, reason);
          }}
        />
      ) : null}
      {writeOff ? (
        <Confirm
          title={t.writeOff}
          body={fill(t.writeOffBody, { count: writeOff.remaining, lot: writeOff.lot ?? "" })}
          yes={t.writeOff}
          no={t.cancel}
          onNo={() => setWriteOff(null)}
          onYes={() => {
            const batch = writeOff;
            setWriteOff(null);
            void machine
              .adjustStock({ productId: product.id, out: batch.remaining, reason: "expiry", batchId: batch.id })
              .then((answer) => after(answer.ok, answer.ok ? undefined : answer.reason));
          }}
        />
      ) : null}
      {archiving ? (
        <Confirm
          title={t.archive}
          body={t.archiveBody}
          yes={t.archive}
          no={t.cancel}
          onNo={() => setArchiving(false)}
          onYes={() => {
            setArchiving(false);
            void machine.archiveProduct(product.id).then((answer) => {
              if (answer.ok) {
                onChanged();
                onClose();
              } else after(false, answer.reason);
            });
          }}
        />
      ) : null}
    </Panel>
  );
}
