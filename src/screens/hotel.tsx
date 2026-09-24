import { useCallback, useEffect, useState } from "react";
import type { AppLanguage, Configuration } from "@app-ui/config";
import { machine, type Folio, type Product, type Room, type Stay } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Choices, Confirm, Empty, Field, Notice, Panel, ScreenHeader, day, localDay, money, moneyText, parseMoney, parseQuantity } from "../ui";
import { PaymentBox, paymentProblem } from "./payment";

/*
 * A hotel's front desk. The board shows every room in its state; a room
 * opens onto whatever it needs next: a free room takes an arrival or a
 * booking, an occupied one shows its bill, a room being cleaned is marked
 * ready. Kept from the old front desk, laid out so the receptionist never
 * has to remember which screen does what.
 */

const STATE_LOOK: Record<Room["state"], string> = {
  available: "border-black/15 bg-surface text-black",
  occupied: "border-black bg-black text-white",
  reserved: "border-black bg-surface text-black",
  cleaning: "border-black/40 bg-black/5 text-black",
  out_of_service: "border-black/10 bg-black/10 text-black/50",
};

function stateLabel(state: Room["state"], tt: TradesCopy): string {
  return {
    available: tt.stateAvailable,
    occupied: tt.stateOccupied,
    reserved: tt.stateReserved,
    cleaning: tt.stateCleaning,
    out_of_service: tt.stateOut,
  }[state];
}

export function Rooms({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const language = configuration.language.app;
  const [rooms, setRooms] = useState<Room[]>([]);
  const [open, setOpen] = useState<Room | null>(null);
  const [managing, setManaging] = useState(false);

  const reload = useCallback(() => {
    void machine.rooms().then((answer) => answer.ok && setRooms(answer.value));
  }, []);
  useEffect(reload, [reload]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.roomsTitle}>
        <Button onClick={() => setManaging(true)}>{tt.manageRooms}</Button>
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {rooms.length === 0 ? (
          <Empty title={tt.noRooms} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            {rooms.map((room) => (
              <button
                key={room.id}
                type="button"
                onClick={() => setOpen(room)}
                className={`flex min-h-[120px] flex-col justify-between rounded-xl border-2 p-4 text-start ${STATE_LOOK[room.state]}`}
              >
                <span>
                  <span className="block text-2xl font-semibold">
                    <bdi>{room.number}</bdi>
                  </span>
                  {room.kind ? <span className="block text-base opacity-80">{room.kind}</span> : null}
                </span>
                <span className="text-base">
                  <span className="block font-semibold">{stateLabel(room.state, tt)}</span>
                  {room.guest ? <span className="block">{room.guest}</span> : null}
                  {room.state === "available" ? <bdi className="block opacity-70">{money(room.rate, language)}</bdi> : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {open ? (
        <RoomPanel
          room={open}
          configuration={configuration}
          t={t}
          tt={tt}
          readOnly={readOnly}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            reload();
          }}
        />
      ) : null}
      {managing ? (
        <ManageRooms
          t={t}
          tt={tt}
          language={language}
          rooms={rooms}
          readOnly={readOnly}
          onClose={() => {
            setManaging(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function RoomPanel({
  room,
  configuration,
  t,
  tt,
  readOnly,
  onClose,
  onChanged,
}: {
  room: Room;
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const title = fill(tt.room, { n: room.number });
  if (room.state === "occupied" && room.stayId) {
    return <StayPanel stayId={room.stayId} title={title} configuration={configuration} t={t} tt={tt} readOnly={readOnly} onClose={onClose} onChanged={onChanged} />;
  }
  if (room.state === "reserved" && room.stayId) {
    return <StayPanel stayId={room.stayId} title={title} configuration={configuration} t={t} tt={tt} readOnly={readOnly} onClose={onClose} onChanged={onChanged} />;
  }
  return (
    <Panel title={title} onClose={onClose} closeLabel={t.close}>
      <p className="text-lg font-semibold">{stateLabel(room.state, tt)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {room.state === "cleaning" ? (
          <Button kind="primary" disabled={readOnly} onClick={() => void machine.setRoomStatus(room.id, "available").then(onChanged)}>
            {tt.markClean}
          </Button>
        ) : null}
        {room.state === "out_of_service" ? (
          <Button kind="primary" disabled={readOnly} onClick={() => void machine.setRoomStatus(room.id, "available").then(onChanged)}>
            {tt.markBack}
          </Button>
        ) : (
          <Button kind="quiet" disabled={readOnly} onClick={() => void machine.setRoomStatus(room.id, "out_of_service").then(onChanged)}>
            {tt.markOut}
          </Button>
        )}
      </div>
      {room.state === "available" || room.state === "cleaning" ? (
        <div className="mt-6">
          <BookingForm room={room} configuration={configuration} t={t} tt={tt} readOnly={readOnly} onDone={onChanged} />
        </div>
      ) : null}
    </Panel>
  );
}

function BookingForm({
  room,
  configuration,
  t,
  tt,
  readOnly,
  onDone,
}: {
  room: Room;
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onDone: () => void;
}) {
  const features = configuration.features.hotel;
  const [mode, setMode] = useState<"now" | "later">("now");
  const [guest, setGuest] = useState("");
  const [phone, setPhone] = useState("");
  const [document, setDocument] = useState("");
  const [nationality, setNationality] = useState("");
  const [adults, setAdults] = useState("1");
  const [arrives, setArrives] = useState(localDay());
  const [leaves, setLeaves] = useState(localDay(1));
  const [rate, setRate] = useState(moneyText(room.rate));
  const [advance, setAdvance] = useState("");
  const [how, setHow] = useState<"cash" | "mobile">("cash");
  const [problem, setProblem] = useState<string | null>(null);
  const rateMinor = parseMoney(rate);
  const advanceMinor = advance.trim() ? parseMoney(advance) : 0;
  const valid = guest.trim() && rateMinor !== null && advanceMinor !== null && leaves > (mode === "now" ? localDay() : arrives);

  async function save() {
    if (!valid) return;
    const answer = await machine.bookStay({
      roomId: room.id,
      guest,
      phone,
      idDocument: document,
      nationality,
      adults: parseQuantity(adults) ?? 1,
      arrivesOn: mode === "now" ? localDay() : arrives,
      leavesOn: leaves,
      rate: rateMinor as number,
      advance: advanceMinor as number,
      advancePayment: how,
      checkInNow: mode === "now",
    });
    if (!answer.ok) {
      setProblem(answer.reason === "room taken" ? tt.roomTaken : answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    onDone();
  }

  return (
    <div className="space-y-3">
      <Choices<"now" | "later">
        value={mode}
        onChange={setMode}
        options={[
          { value: "now", label: tt.arriveNow },
          { value: "later", label: tt.book },
        ]}
      />
      <Field label={tt.guest} value={guest} onChange={setGuest} autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <Field label={tt.phone} value={phone} onChange={setPhone} ltr />
        <Field label={tt.adults} value={adults} onChange={setAdults} kind="number" />
        {features?.guestDocument !== false ? <Field label={tt.idDocument} value={document} onChange={setDocument} ltr /> : null}
        {features?.guestDocument !== false ? <Field label={tt.nationality} value={nationality} onChange={setNationality} /> : null}
        {mode === "later" ? <Field label={tt.arrivesOn} value={arrives} onChange={setArrives} kind="date" /> : null}
        <Field label={tt.leavesOn} value={leaves} onChange={setLeaves} kind="date" />
        <Field label={tt.rate} value={rate} onChange={setRate} kind="amount" error={rateMinor === null ? t.badAmount : null} />
        {features?.advances !== false ? <Field label={tt.advance} value={advance} onChange={setAdvance} kind="amount" error={advanceMinor === null ? t.badAmount : null} /> : null}
      </div>
      {features?.advances !== false && advanceMinor ? (
        <Choices<"cash" | "mobile"> value={how} onChange={setHow} options={[{ value: "cash", label: t.payCash }, { value: "mobile", label: t.payMobile }]} />
      ) : null}
      {problem ? <Notice kind="problem" text={problem} /> : null}
      <Button kind="primary" big wide disabled={readOnly || !valid} onClick={() => void save()}>
        {mode === "now" ? tt.checkIn : tt.book}
      </Button>
    </div>
  );
}

function StayPanel({
  stayId,
  title,
  configuration,
  t,
  tt,
  readOnly,
  onClose,
  onChanged,
}: {
  stayId: string;
  title: string;
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const language = configuration.language.app;
  const features = configuration.features.hotel;
  const [folio, setFolio] = useState<Folio | null>(null);
  const [extras, setExtras] = useState<Product[]>([]);
  const [what, setWhat] = useState("");
  const [price, setPrice] = useState("");
  const [count, setCount] = useState("1");
  const [advance, setAdvance] = useState("");
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refund, setRefund] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    void machine.folio(stayId).then((answer) => answer.ok && setFolio(answer.value));
  }, [stayId]);
  useEffect(() => {
    load();
    void machine.products().then(setExtras);
  }, [load]);

  if (!folio) return null;
  const stay: Stay = folio.stay;

  const addExtra = async (label: string, unitPrice: number, quantity = 1) => {
    const answer = await machine.addCharge({ stayId, label, unitPrice, quantity });
    if (!answer.ok) setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
    load();
  };

  return (
    <Panel title={`${title} · ${stay.guest}`} onClose={onClose} closeLabel={t.close}>
      <p className="text-base text-black/70">
        {day(stay.arrivesOn, language)} → {day(stay.leavesOn, language)} · {fill(tt.nights, { count: folio.nights })}
        {stay.phone ? <> · <bdi dir="ltr">{stay.phone}</bdi></> : null}
      </p>
      {stay.idDocument ? <p className="text-base text-black/60">{tt.idDocument} : <bdi>{stay.idDocument}</bdi></p> : null}

      <h3 className="mt-5 text-lg font-semibold">{tt.folio}</h3>
      <ul className="mt-2">
        {folio.lines.map((line, index) => (
          <li key={index} className="flex justify-between gap-3 border-b border-black/10 py-2 text-base">
            <span>{line.label}{line.kind === "service" && line.quantity !== 1 ? ` × ${line.quantity}` : ""}</span>
            <bdi>{money(line.total, language)}</bdi>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-between text-xl font-bold">
        <span>{t.total}</span>
        <bdi>{money(folio.total, language)}</bdi>
      </div>
      {folio.received > 0 ? <p className="text-base">{fill(tt.received, { amount: money(folio.received, language) })}</p> : null}
      <p className="text-lg font-semibold">{fill(tt.balance, { amount: money(folio.balance, language) })}</p>
      {problem ? <div className="mt-3"><Notice kind="problem" text={problem} /></div> : null}

      {stay.status === "in" && features?.extras !== false ? (
        <div className="mt-5 rounded-lg border-2 border-black/10 p-3">
          <div className="mb-2 text-base font-semibold">{tt.addExtra}</div>
          {extras.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {extras.slice(0, 12).map((extra) => (
                <Button key={extra.id} disabled={readOnly} onClick={() => void addExtra(extra.name, extra.salePrice)}>
                  {extra.name} · <bdi>{money(extra.salePrice, language)}</bdi>
                </Button>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[1fr_90px_130px_auto] items-end gap-2">
            <Field label={tt.extraWhat} value={what} onChange={setWhat} />
            <Field label={tt.quantityShort} value={count} onChange={setCount} kind="number" />
            <Field label={tt.extraPrice} value={price} onChange={setPrice} kind="amount" />
            <Button
              disabled={readOnly || !what.trim() || parseMoney(price) === null}
              onClick={() => {
                void addExtra(what, parseMoney(price) as number, parseQuantity(count) ?? 1);
                setWhat("");
                setPrice("");
                setCount("1");
              }}
            >
              {tt.addItem}
            </Button>
          </div>
        </div>
      ) : null}

      {features?.advances !== false && stay.status !== "out" ? (
        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <Field label={tt.takeAdvance} value={advance} onChange={setAdvance} kind="amount" />
          </div>
          <Button
            disabled={readOnly || !parseMoney(advance)}
            onClick={() => void machine.addAdvance(stayId, parseMoney(advance) as number, "cash").then(() => { setAdvance(""); load(); })}
          >
            {t.payCash}
          </Button>
          <Button
            disabled={readOnly || !parseMoney(advance)}
            onClick={() => void machine.addAdvance(stayId, parseMoney(advance) as number, "mobile").then(() => { setAdvance(""); load(); })}
          >
            {t.payMobile}
          </Button>
        </div>
      ) : null}

      <div className="mt-6 space-y-3">
        <Button onClick={() => void machine.printFolio(stayId)}>{tt.printIt}</Button>
        {stay.status === "reserved" ? (
          <div className="flex flex-wrap gap-2">
            <Button kind="primary" big disabled={readOnly} onClick={() => void machine.checkIn(stayId).then(onChanged)}>
              {tt.checkIn}
            </Button>
            <Button kind="quiet" disabled={readOnly} onClick={() => setCancelling(true)}>
              {tt.cancelStay}
            </Button>
          </div>
        ) : null}
        {stay.status === "in" ? (
          paying ? (
            <PaymentBox
              total={Math.max(0, folio.balance)}
              t={t}
              language={language}
              creditEnabled={configuration.common.credit.enabled}
              readOnly={readOnly}
              actionLabel={tt.pay}
              problem={problem}
              onPay={async (choice) => {
                const answer = await machine.checkOut(stayId, choice);
                if (!answer.ok) setProblem(paymentProblem(answer.reason, t));
                else onChanged();
              }}
            />
          ) : (
            <Button kind="primary" big wide disabled={readOnly} onClick={() => setPaying(true)}>
              {tt.checkOut}
            </Button>
          )
        ) : null}
      </div>

      {cancelling ? (
        <Confirm
          title={tt.cancelStay}
          body={folio.received > 0 ? tt.cancelStayBody : undefined}
          yes={tt.cancelStay}
          no={tt.back}
          onNo={() => setCancelling(false)}
          onYes={() => {
            setCancelling(false);
            void machine.cancelStay(stayId, refund).then(onChanged);
          }}
        >
          {folio.received > 0 ? (
            <Choices<"refund" | "keep">
              value={refund ? "refund" : "keep"}
              onChange={(value) => setRefund(value === "refund")}
              options={[
                { value: "refund", label: tt.refund },
                { value: "keep", label: tt.keep },
              ]}
            />
          ) : null}
        </Confirm>
      ) : null}
    </Panel>
  );
}

function ManageRooms({
  t,
  tt,
  language,
  rooms,
  readOnly,
  onClose,
}: {
  t: ScreensCopy;
  tt: TradesCopy;
  language: AppLanguage;
  rooms: Room[];
  readOnly: boolean;
  onClose: () => void;
}) {
  const [number, setNumber] = useState("");
  const [kind, setKind] = useState("");
  const [rate, setRate] = useState("");
  const [capacity, setCapacity] = useState("2");
  const [problem, setProblem] = useState<string | null>(null);
  const [list, setList] = useState(rooms);
  const reload = () => void machine.rooms().then((answer) => answer.ok && setList(answer.value));

  return (
    <Panel title={tt.manageRooms} onClose={onClose} closeLabel={t.close}>
      <ul>
        {list.map((room) => (
          <RoomRow key={room.id} room={room} t={t} tt={tt} language={language} readOnly={readOnly} onSaved={reload} />
        ))}
      </ul>
      <div className="mt-5 grid grid-cols-2 gap-3 rounded-lg border-2 border-black/10 p-3">
        <Field label={tt.roomNumber} value={number} onChange={setNumber} ltr />
        <Field label={tt.roomKind} value={kind} onChange={setKind} />
        <Field label={tt.rate} value={rate} onChange={setRate} kind="amount" />
        <Field label={tt.capacity} value={capacity} onChange={setCapacity} kind="number" />
        {problem ? <div className="col-span-2"><Notice kind="problem" text={problem} /></div> : null}
        <div className="col-span-2">
          <Button
            kind="primary"
            disabled={readOnly || !number.trim() || parseMoney(rate) === null}
            onClick={() =>
              void machine.addRoom({ number, kind, rate: parseMoney(rate) as number, capacity: parseQuantity(capacity) ?? 2 }).then((answer) => {
                if (!answer.ok) {
                  setProblem(answer.reason === "room exists" ? `${tt.roomNumber} ${number}` : t.notSaved);
                  return;
                }
                setProblem(null);
                setNumber("");
                reload();
              })
            }
          >
            {tt.addRoom}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function RoomRow({ room, t, tt, language, readOnly, onSaved }: { room: Room; t: ScreensCopy; tt: TradesCopy; language: AppLanguage; readOnly: boolean; onSaved: () => void }) {
  const [rate, setRate] = useState(moneyText(room.rate));
  const changed = parseMoney(rate) !== null && parseMoney(rate) !== room.rate;
  return (
    <li className="flex items-end justify-between gap-3 border-b border-black/10 py-2">
      <span className="pb-3 text-base">
        <b><bdi>{room.number}</bdi></b> {room.kind ? `· ${room.kind}` : ""} · {room.capacity} · <bdi>{money(room.rate, language)}</bdi>
      </span>
      <span className="flex items-end gap-2">
        <div className="w-[130px]">
          <Field label={tt.rate} value={rate} onChange={setRate} kind="amount" />
        </div>
        <Button disabled={readOnly || !changed} onClick={() => void machine.updateRoom(room.id, { rate: parseMoney(rate) as number }).then(onSaved)}>
          {t.save}
        </Button>
      </span>
    </li>
  );
}

/* Bookings: who arrives today, who leaves, who is in, who is coming. */
export function Stays({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const language = configuration.language.app;
  const [stays, setStays] = useState<Stay[]>([]);
  const [open, setOpen] = useState<Stay | null>(null);
  const reload = useCallback(() => {
    void machine.stays("current").then((answer) => answer.ok && setStays(answer.value));
  }, []);
  useEffect(reload, [reload]);

  const today = localDay();
  const groups: [string, Stay[]][] = [
    [tt.arrivalsToday, stays.filter((stay) => stay.status === "reserved" && stay.arrivesOn <= today)],
    [tt.departuresToday, stays.filter((stay) => stay.status === "in" && stay.leavesOn <= today)],
    [tt.inHouse, stays.filter((stay) => stay.status === "in" && stay.leavesOn > today)],
    [tt.upcoming, stays.filter((stay) => stay.status === "reserved" && stay.arrivesOn > today)],
  ];

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.staysTitle} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {stays.length === 0 ? <Empty title={tt.noStays} /> : null}
        {groups
          .filter(([, list]) => list.length > 0)
          .map(([label, list]) => (
            <section key={label} className="mb-6">
              <h2 className="text-xl font-semibold">{label}</h2>
              <ul className="mt-2">
                {list.map((stay) => (
                  <li key={stay.id}>
                    <button type="button" onClick={() => setOpen(stay)} className="flex w-full items-center justify-between gap-3 border-b border-black/10 py-3 text-start hover:bg-black/5">
                      <span>
                        <span className="block text-lg font-semibold">
                          {fill(tt.room, { n: stay.roomNumber })} · {stay.guest}
                        </span>
                        <span className="block text-base text-black/60">
                          {day(stay.arrivesOn, language)} → {day(stay.leavesOn, language)}
                          {stay.phone ? <> · <bdi dir="ltr">{stay.phone}</bdi></> : null}
                        </span>
                      </span>
                      <bdi className="text-base">{money(stay.rate, language)}</bdi>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
      {open ? (
        <StayPanel
          stayId={open.id}
          title={fill(tt.room, { n: open.roomNumber })}
          configuration={configuration}
          t={t}
          tt={tt}
          readOnly={readOnly}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
