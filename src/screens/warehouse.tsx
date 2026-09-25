import { useCallback, useEffect, useMemo, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type Dispatch, type Location, type Product } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { periodOf } from "./reports";
import { Button, Choices, Empty, Field, Notice, ScreenHeader, money, moneyText, parseMoney, parseQuantity, when } from "../ui";
import { PaymentBox, paymentProblem, type PaymentChoice } from "./payment";

/*
 * A warehouse's movements: goods in from a supplier, goods out on a numbered
 * note to a customer, one of the owner's shops or a site, and goods moved
 * from one place to another. Each tab is one form that writes one kind of
 * movement, and the notes tab lists what left, ready to print again.
 */

type Tab = "in" | "out" | "transfer" | "notes";
type Destination = "customers" | "my_shops" | "sites";
type Line = { product: Product; quantity: number; unitPrice: number };

export function Moves({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const features = configuration.features.warehouse;
  const destinations = (features?.destinations ?? ["customers"]) as Destination[];
  const [tab, setTab] = useState<Tab>("in");
  const [products, setProducts] = useState<Product[]>([]);
  const [places, setPlaces] = useState<Location[]>([]);
  const [held, setHeld] = useState<{ productId: string; locationId: string; quantity: number }[]>([]);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);

  const reload = useCallback(() => {
    void machine.products().then(setProducts);
    void machine.locations().then((answer) => answer.ok && setPlaces(answer.value));
    void machine.stockByLocation().then((answer) => answer.ok && setHeld(answer.value));
  }, []);
  useEffect(reload, [reload]);

  const heldAt = (productId: string, locationId: string) =>
    held.find((row) => row.productId === productId && row.locationId === locationId)?.quantity ?? 0;

  const done = (text: string) => {
    setNote({ text, kind: "done" });
    reload();
  };
  const failed = (reason: string) => setNote({ text: reason === "read_only" ? t.readOnly : paymentProblem(reason, t), kind: "problem" });

  const destinationLabels = tt.destinations.split("|");
  const destinationLabel: Record<Destination, string> = { customers: destinationLabels[0], my_shops: destinationLabels[1], sites: destinationLabels[2] };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.movesTitle} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <Choices<Tab>
          value={tab}
          onChange={(value) => {
            setTab(value);
            setNote(null);
          }}
          options={[
            { value: "in", label: tt.tabIn },
            { value: "out", label: tt.tabOut },
            ...(places.length > 1 ? [{ value: "transfer" as const, label: tt.tabTransfer }] : []),
            { value: "notes", label: tt.tabNotes },
          ]}
        />
        {note ? <div className="mt-4"><Notice kind={note.kind} text={note.text} /></div> : null}
        <div className="mt-5 max-w-3xl">
          {tab === "in" ? (
            <GoodsIn t={t} tt={tt} products={products} places={places} readOnly={readOnly} onDone={() => done(tt.inDone)} onFailed={failed} />
          ) : null}
          {tab === "out" ? (
            <GoodsOut
              configuration={configuration}
              t={t}
              tt={tt}
              products={products}
              places={places}
              heldAt={heldAt}
              destinations={destinations}
              destinationLabel={destinationLabel}
              sells={features?.sellsDirect ?? false}
              readOnly={readOnly}
              onDone={(number) => done(fill(tt.noteDone, { number }))}
              onFailed={failed}
            />
          ) : null}
          {tab === "transfer" ? (
            <Transfer t={t} tt={tt} products={products} places={places} heldAt={heldAt} readOnly={readOnly} onDone={() => done(tt.transferDone)} onFailed={failed} />
          ) : null}
          {tab === "notes" ? <Notes configuration={configuration} t={t} tt={tt} destinationLabel={destinationLabel} /> : null}
        </div>
      </div>
    </div>
  );
}

function ProductSelect({ label, products, value, onChange, choose }: { label: string; products: Product[]; value: string; onChange: (id: string) => void; choose: string }) {
  return (
    <label className="block">
      <span className="text-base text-ink-2">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-[48px] w-full rounded-lg border-2 border-line-strong bg-surface px-2 text-base">
        <option value="">{choose}</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
            {product.unit ? ` (${product.unit})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function PlaceSelect({ label, places, value, onChange }: { label: string; places: Location[]; value: string; onChange: (id: string) => void }) {
  if (places.length <= 1) return null;
  return (
    <label className="block">
      <span className="text-base text-ink-2">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-[48px] w-full rounded-lg border-2 border-line-strong bg-surface px-2 text-base">
        {places.map((place) => (
          <option key={place.id} value={place.id}>
            {place.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function GoodsIn({
  t,
  tt,
  products,
  places,
  readOnly,
  onDone,
  onFailed,
}: {
  t: ScreensCopy;
  tt: TradesCopy;
  products: Product[];
  places: Location[];
  readOnly: boolean;
  onDone: () => void;
  onFailed: (reason: string) => void;
}) {
  const [productId, setProductId] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const count = parseQuantity(quantity);
  const costMinor = cost.trim() ? parseMoney(cost) : null;
  const place = placeId || places[0]?.id || "";

  async function save() {
    if (!productId || !count || (cost.trim() && costMinor === null)) return;
    const answer = await machine.receiveStock({
      productId,
      quantity: count,
      costPrice: costMinor,
      supplierName: supplier || null,
      note: reference || null,
      locationId: place || null,
    });
    if (!answer.ok) return onFailed(answer.reason);
    setQuantity("");
    setReference("");
    onDone();
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <ProductSelect label={tt.article} products={products} value={productId} onChange={setProductId} choose={tt.choose} />
      </div>
      <PlaceSelect label={tt.place} places={places} value={place} onChange={setPlaceId} />
      <Field label={t.quantity} value={quantity} onChange={setQuantity} kind="number" error={quantity.trim() && !count ? t.badQuantity : null} />
      <Field label={t.costPrice} value={cost} onChange={setCost} kind="amount" error={cost.trim() && costMinor === null ? t.badAmount : null} />
      <Field label={t.supplier} value={supplier} onChange={setSupplier} />
      <Field label={t.note} value={reference} onChange={setReference} />
      <div className="col-span-2">
        <Button kind="primary" big disabled={readOnly || !productId || !count} onClick={() => void save()}>
          {tt.saveIn}
        </Button>
      </div>
    </div>
  );
}

function GoodsOut({
  configuration,
  t,
  tt,
  products,
  places,
  heldAt,
  destinations,
  destinationLabel,
  sells,
  readOnly,
  onDone,
  onFailed,
}: {
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  products: Product[];
  places: Location[];
  heldAt: (productId: string, locationId: string) => number;
  destinations: Destination[];
  destinationLabel: Record<Destination, string>;
  sells: boolean;
  readOnly: boolean;
  onDone: (number: number) => void;
  onFailed: (reason: string) => void;
}) {
  const language = configuration.language.app;
  const [destination, setDestination] = useState<Destination>(destinations[0] ?? "customers");
  const [recipient, setRecipient] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [sell, setSell] = useState(false);
  const [paying, setPaying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const place = placeId || places[0]?.id || "";
  const total = lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice), 0);
  const canSell = sells && destination === "customers";

  const addLine = () => {
    const product = products.find((one) => one.id === productId);
    const count = parseQuantity(quantity);
    const unitPrice = price.trim() ? parseMoney(price) : product?.salePrice ?? 0;
    if (!product || !count || unitPrice === null) return;
    setLines([...lines, { product, quantity: count, unitPrice }]);
    setProductId("");
    setQuantity("");
    setPrice("");
  };

  async function send(choice?: PaymentChoice) {
    if (!recipient.trim() || lines.length === 0) return;
    const answer = await machine.dispatch({
      destination,
      recipient,
      locationId: place || null,
      lines: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity, unitPrice: line.unitPrice })),
      sell: sell && canSell && choice ? choice : undefined,
    });
    if (!answer.ok) {
      setProblem(paymentProblem(answer.reason, t));
      onFailed(answer.reason);
      return;
    }
    void machine.printDispatch(answer.value.id);
    setLines([]);
    setRecipient("");
    setPaying(false);
    onDone(answer.value.number);
  }

  return (
    <div className="space-y-4">
      {destinations.length > 1 ? (
        <div>
          <div className="mb-1 text-base text-ink-2">{tt.destination}</div>
          <Choices<Destination> value={destination} onChange={setDestination} options={destinations.map((one) => ({ value: one, label: destinationLabel[one] }))} />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label={tt.recipient} value={recipient} onChange={setRecipient} />
        <PlaceSelect label={tt.fromPlace} places={places} value={place} onChange={setPlaceId} />
      </div>

      <div className="rounded-lg border-2 border-line p-4">
        <ul>
          {lines.map((line, index) => (
            <li key={`${line.product.id}-${index}`} className="flex items-center justify-between gap-3 border-b border-line py-2 text-base">
              <span>
                {line.quantity} {line.product.unit ?? ""} × {line.product.name}
              </span>
              <span className="flex items-center gap-2">
                {sell && canSell ? <bdi>{money(Math.round(line.quantity * line.unitPrice), language)}</bdi> : null}
                <Button kind="quiet" onClick={() => setLines(lines.filter((_, at) => at !== index))}>
                  {t.remove}
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 grid grid-cols-[1fr_110px_140px_auto] items-end gap-2">
          <ProductSelect label={tt.article} products={products} value={productId} onChange={(id) => { setProductId(id); setPrice(moneyText(products.find((one) => one.id === id)?.salePrice)); }} choose={tt.choose} />
          <Field label={tt.quantityShort} value={quantity} onChange={setQuantity} kind="number" />
          {sell && canSell ? <Field label={t.salePrice} value={price} onChange={setPrice} kind="amount" /> : <div />}
          <Button onClick={addLine}>{tt.addLine}</Button>
        </div>
        {productId && place ? <p className="mt-2 text-base text-ink-3">{fill(tt.heldHere, { count: heldAt(productId, place) })}</p> : null}
      </div>

      {canSell ? (
        <Choices<"send" | "sell">
          value={sell ? "sell" : "send"}
          onChange={(value) => setSell(value === "sell")}
          options={[
            { value: "send", label: tt.saveNote },
            { value: "sell", label: tt.sellIt },
          ]}
        />
      ) : null}

      {problem ? <Notice kind="problem" text={problem} /> : null}
      {lines.length === 0 ? <p className="text-base text-ink-3">{tt.noLines}</p> : null}

      {sell && canSell ? (
        paying ? (
          <PaymentBox
            total={total}
            t={t}
            language={language}
            creditEnabled={configuration.common.credit.enabled}
            readOnly={readOnly}
            actionLabel={tt.pay}
            onPay={(choice) => send(choice)}
          />
        ) : (
          <Button kind="primary" big disabled={readOnly || !recipient.trim() || lines.length === 0} onClick={() => setPaying(true)}>
            {fill(tt.pay, { amount: money(total, language) })}
          </Button>
        )
      ) : (
        <Button kind="primary" big disabled={readOnly || !recipient.trim() || lines.length === 0} onClick={() => void send()}>
          {tt.saveNote}
        </Button>
      )}
    </div>
  );
}

function Transfer({
  t,
  tt,
  products,
  places,
  heldAt,
  readOnly,
  onDone,
  onFailed,
}: {
  t: ScreensCopy;
  tt: TradesCopy;
  products: Product[];
  places: Location[];
  heldAt: (productId: string, locationId: string) => number;
  readOnly: boolean;
  onDone: () => void;
  onFailed: (reason: string) => void;
}) {
  const [productId, setProductId] = useState("");
  const [from, setFrom] = useState(places[0]?.id ?? "");
  const [to, setTo] = useState(places[1]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const count = parseQuantity(quantity);

  async function save() {
    if (!productId || !count || from === to) return;
    const answer = await machine.transfer({ productId, quantity: count, from, to });
    if (!answer.ok) return onFailed(answer.reason);
    setQuantity("");
    onDone();
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <ProductSelect label={tt.article} products={products} value={productId} onChange={setProductId} choose={tt.choose} />
      </div>
      <PlaceSelect label={tt.fromPlace} places={places} value={from} onChange={setFrom} />
      <PlaceSelect label={tt.toPlace} places={places} value={to} onChange={setTo} />
      <Field label={t.quantity} value={quantity} onChange={setQuantity} kind="number" error={quantity.trim() && !count ? t.badQuantity : null} />
      <div className="self-end pb-3 text-base text-ink-3">{productId ? fill(tt.heldHere, { count: heldAt(productId, from) }) : null}</div>
      <div className="col-span-2">
        <Button kind="primary" big disabled={readOnly || !productId || !count || from === to} onClick={() => void save()}>
          {tt.saveTransfer}
        </Button>
      </div>
    </div>
  );
}

function Notes({ configuration, t, tt, destinationLabel }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; destinationLabel: Record<Destination, string> }) {
  const language = configuration.language.app;
  const [range, setRange] = useState<"today" | "week" | "month">("week");
  const [notes, setNotes] = useState<Dispatch[]>([]);
  const period = useMemo(() => periodOf(range), [range]);
  useEffect(() => {
    void machine.dispatchesBetween(period.from, period.to).then((answer) => answer.ok && setNotes(answer.value));
  }, [period]);

  return (
    <div>
      <Choices<"today" | "week" | "month">
        value={range}
        onChange={setRange}
        options={[
          { value: "today", label: t.today },
          { value: "week", label: t.week },
          { value: "month", label: t.month },
        ]}
      />
      {notes.length === 0 ? (
        <Empty title={tt.noNotes} />
      ) : (
        <ul className="mt-4">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start justify-between gap-4 border-b border-line py-3">
              <span>
                <span className="block text-lg font-semibold">
                  n° <bdi>{note.number}</bdi> · {note.recipient}
                </span>
                <span className="block text-base text-ink-3">
                  {destinationLabel[note.destination]} · <bdi>{when(note.occurredAt, language)}</bdi>
                  {note.locationName ? ` · ${note.locationName}` : ""}
                </span>
                <span className="block text-base">{note.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ")}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {note.total !== null ? <bdi className="font-semibold">{money(note.total, language)}</bdi> : null}
                <Button onClick={() => void machine.printDispatch(note.id)}>{tt.printIt}</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* The warehouse's own figures for a period: what came in, what went out. */
export function Flows({ configuration, t, tt }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy }) {
  const [range, setRange] = useState<"today" | "week" | "month">("month");
  const [rows, setRows] = useState<{ productId: string; name: string; unit: string | null; received: number; sent: number; sold: number; adjusted: number }[]>([]);
  const period = useMemo(() => periodOf(range), [range]);
  useEffect(() => {
    void machine.warehouseFlows(period.from, period.to).then((answer) => answer.ok && setRows(answer.value));
  }, [period]);
  void configuration;
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold">{tt.flowsTitle}</h2>
      <div className="mt-3">
        <Choices<"today" | "week" | "month">
          value={range}
          onChange={setRange}
          options={[
            { value: "today", label: t.today },
            { value: "week", label: t.week },
            { value: "month", label: t.month },
          ]}
        />
      </div>
      <table className="mt-3 w-full text-base">
        <thead>
          <tr className="border-b-2 border-line text-ink-3">
            <th className="py-2 text-start font-normal">{t.colName}</th>
            <th className="py-2 text-end font-normal">{tt.colIn}</th>
            <th className="py-2 text-end font-normal">{tt.colOut}</th>
            <th className="py-2 text-end font-normal">{tt.colSold}</th>
            <th className="py-2 text-end font-normal">{tt.colAdjusted}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.productId} className="border-b border-line">
              <td className="py-2">{row.name}</td>
              <td className="py-2 text-end"><bdi>{row.received}</bdi></td>
              <td className="py-2 text-end"><bdi>{row.sent}</bdi></td>
              <td className="py-2 text-end"><bdi>{row.sold}</bdi></td>
              <td className="py-2 text-end"><bdi>{row.adjusted}</bdi></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* The warehouse's places, named as the owner calls them. */
export function Places({ t, tt, readOnly }: { t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const [places, setPlaces] = useState<Location[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const reload = useCallback(() => {
    void machine.locations().then((answer) => answer.ok && setPlaces(answer.value));
  }, []);
  useEffect(reload, [reload]);
  return (
    <section>
      <h2 className="text-xl font-semibold">{tt.places}</h2>
      <ul className="mt-3">
        {places.map((place) => (
          <li key={place.id} className="flex items-center justify-between gap-3 border-b border-line py-2">
            {editing?.id === place.id ? (
              <>
                <Field label={tt.rename} value={editing.name} onChange={(value) => setEditing({ id: place.id, name: value })} />
                <Button kind="primary" onClick={() => void machine.renameLocation(place.id, editing.name).then(() => { setEditing(null); reload(); })}>
                  {t.save}
                </Button>
              </>
            ) : (
              <>
                <span className="text-base">{place.name}</span>
                <Button kind="quiet" disabled={readOnly} onClick={() => setEditing({ id: place.id, name: place.name })}>
                  {tt.rename}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1">
          <Field label={tt.addPlace} value={name} onChange={setName} />
        </div>
        <Button disabled={readOnly || !name.trim()} onClick={() => void machine.addLocation(name).then(() => { setName(""); reload(); })}>
          {tt.addPlace}
        </Button>
      </div>
    </section>
  );
}
