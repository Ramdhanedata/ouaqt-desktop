import { useCallback, useEffect, useState } from "react";
import type { AppLanguage, Configuration } from "@app-ui/config";
import { machine, type Folio, type Issue, type Product, type Room, type Stay, type StayLine } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Choices, Confirm, Empty, Field, Notice, Panel, ScreenHeader, day, localDay, money, moneyText, parseMoney, parseQuantity, when } from "../ui";
import { PaymentBox, paymentProblem } from "./payment";

/*
 * A hotel's front desk. The board shows every room in its state; a room
 * opens onto whatever it needs next: a free room takes an arrival or a
 * booking, an occupied one shows its bill, a room being cleaned is marked
 * ready. Kept from the old front desk, laid out so the receptionist never
 * has to remember which screen does what.
 */

/*
 * The board as the owner's own hotel app laid it out: each room a card with
 * its state in colour, its type and floor, the guest in it, when they leave
 * and what they still owe, and the one thing to do next. Searched and
 * filtered by state, type and floor.
 */
/* Up to this many rooms the board fits one screen, and filters by type or floor only add clutter. */
const FILTERS_FROM = 12; // not-a-rule: a board that is read at a glance

const STATE_BAR: Record<Room["state"], string> = {
  available: "border-s-success",
  occupied: "border-s-accent",
  reserved: "border-s-warning",
  cleaning: "border-s-line-strong",
  maintenance: "border-s-danger",
  out_of_service: "border-s-ink-3",
};

const STATE_BADGE: Record<Room["state"], string> = {
  available: "bg-success-soft text-success",
  occupied: "bg-accent text-accent-foreground",
  reserved: "bg-warning-soft text-warning",
  cleaning: "bg-hover text-ink-2",
  maintenance: "bg-danger-soft text-danger",
  out_of_service: "bg-selected text-ink-3",
};

function stateLabel(state: Room["state"], tt: TradesCopy): string {
  return {
    available: tt.stateAvailable,
    occupied: tt.stateOccupied,
    reserved: tt.stateReserved,
    cleaning: tt.stateCleaning,
    maintenance: tt.stateMaintenance,
    out_of_service: tt.stateOut,
  }[state];
}

function StateBadge({ state, tt }: { state: Room["state"]; tt: TradesCopy }) {
  return <span className={`inline-block rounded-md px-2 py-0.5 text-base font-semibold ${STATE_BADGE[state]}`}>{stateLabel(state, tt)}</span>;
}

export function Rooms({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const language = configuration.language.app;
  const [rooms, setRooms] = useState<Room[]>([]);
  const [open, setOpen] = useState<Room | null>(null);
  const [managing, setManaging] = useState(false);
  const [booking, setBooking] = useState(false);
  const [term, setTerm] = useState("");
  const [state, setState] = useState("");
  const [kind, setKind] = useState("");
  const [floor, setFloor] = useState("");

  const reload = useCallback(() => {
    void machine.rooms().then((answer) => answer.ok && setRooms(answer.value));
  }, []);
  useEffect(reload, [reload]);

  const kinds = [...new Set(rooms.map((room) => room.kind).filter((value): value is string => Boolean(value)))].sort();
  const floors = [...new Set(rooms.map((room) => room.floor).filter((value): value is number => value !== null))].sort((a, b) => a - b);
  const needle = term.trim().toLocaleLowerCase();
  const shown = rooms.filter(
    (room) =>
      (!needle || room.number.toLocaleLowerCase().includes(needle) || (room.guest ?? "").toLocaleLowerCase().includes(needle)) &&
      (!state || room.state === state) &&
      (!kind || room.kind === kind) &&
      (!floor || String(room.floor) === floor)
  );
  const states: Room["state"][] = ["available", "occupied", "reserved", "cleaning", "maintenance", "out_of_service"];

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.roomsTitle}>
        <Button onClick={() => setManaging(true)}>{tt.manageRooms}</Button>
        <Button kind="primary" disabled={readOnly} onClick={() => setBooking(true)}>
          {tt.newBooking}
        </Button>
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {rooms.length === 0 ? (
          <Empty title={tt.noRooms} />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder={tt.searchRooms}
                aria-label={tt.searchRooms}
                className="min-h-[48px] min-w-[220px] flex-1 rounded-lg border-2 border-line-strong px-4 text-base outline-none focus:border-ink"
              />
              <Filter label={tt.allStates} value={state} onChange={setState} options={states.map((one) => ({ value: one, label: stateLabel(one, tt) }))} />
              {/* A small house is read at a glance: its type and floor filters only come with more rooms. */}
              {kinds.length > 1 && rooms.length > FILTERS_FROM ? <Filter label={tt.allKinds} value={kind} onChange={setKind} options={kinds.map((one) => ({ value: one, label: one }))} /> : null}
              {floors.length > 1 && rooms.length > FILTERS_FROM ? (
                <Filter label={tt.allFloors} value={floor} onChange={setFloor} options={floors.map((one) => ({ value: String(one), label: fill(tt.floorN, { n: one }) }))} />
              ) : null}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
              {shown.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setOpen(room)}
                  className={`flex min-h-[176px] flex-col rounded-xl border-2 border-s-[6px] border-line bg-surface p-4 text-start hover:border-ink ${STATE_BAR[room.state]}`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <bdi className="text-2xl font-bold">{room.number}</bdi>
                    <StateBadge state={room.state} tt={tt} />
                  </span>
                  <span className="mt-1 text-base text-ink-3">
                    {[room.kind, room.floor !== null ? fill(tt.floorN, { n: room.floor }) : null].filter(Boolean).join(" · ")}
                  </span>
                  {room.guest ? <span className="mt-2 text-lg font-semibold">{room.guest}</span> : null}
                  <span className="mt-1 text-base text-ink-2">
                    {room.state === "occupied" ? (
                      <>
                        {room.leavesOn ? <span className="block">{fill(tt.departureOn, { date: day(room.leavesOn, language) })}</span> : null}
                        {room.balance !== null ? (
                          <span className={`block font-semibold ${room.balance > 0 ? "text-danger" : "text-success"}`}>
                            {fill(tt.balanceShort, { amount: money(Math.max(0, room.balance), language) })}
                          </span>
                        ) : null}
                      </>
                    ) : room.state === "reserved" && room.arrivesOn ? (
                      fill(tt.arrivalOn, { date: day(room.arrivesOn, language) })
                    ) : room.state === "maintenance" || room.state === "cleaning" ? (
                      tt.waitingService
                    ) : room.state === "available" ? (
                      <>
                        <span className="block">{tt.readyForArrival}</span>
                        <bdi className="block">{money(room.rate, language)}</bdi>
                      </>
                    ) : null}
                  </span>
                  <span
                    className={`mt-auto flex min-h-[44px] items-center justify-center rounded-lg text-base font-semibold ${
                      room.state === "available" ? "bg-ink text-on-ink" : "border-2 border-line-strong"
                    }`}
                  >
                    {room.state === "available" ? tt.bookRoom : tt.openRoom}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {open ? (
        <RoomPanel
          room={open}
          rooms={rooms}
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
      {booking ? (
        <NewBooking
          rooms={rooms}
          configuration={configuration}
          t={t}
          tt={tt}
          readOnly={readOnly}
          onClose={() => setBooking(false)}
          onDone={() => {
            setBooking(false);
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

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-[48px] rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink"
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/* A booking started from the board's button: the free rooms first, then the guest. */
function NewBooking({
  rooms,
  configuration,
  t,
  tt,
  readOnly,
  onClose,
  onDone,
}: {
  rooms: Room[];
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const language = configuration.language.app;
  const [room, setRoom] = useState<Room | null>(null);
  const free = rooms.filter((one) => one.state === "available");
  return (
    <Panel title={room ? `${tt.newBooking} · ${fill(tt.room, { n: room.number })}` : tt.newBooking} onClose={onClose} closeLabel={t.close}>
      {room ? (
        <BookingForm room={room} configuration={configuration} t={t} tt={tt} readOnly={readOnly} onDone={onDone} />
      ) : free.length === 0 ? (
        <p className="text-lg text-ink-3">{tt.noFreeRoom}</p>
      ) : (
        <>
          <p className="mb-3 text-base text-ink-2">{tt.chooseRoom}</p>
          <div className="grid grid-cols-2 gap-3">
            {free.map((one) => (
              <button
                key={one.id}
                type="button"
                onClick={() => setRoom(one)}
                className="flex min-h-[88px] flex-col justify-between rounded-xl border-2 border-line-strong bg-surface p-3 text-start hover:border-ink"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <bdi className="text-xl font-bold">{one.number}</bdi>
                  <span className="text-base text-ink-3">{one.kind ?? ""}</span>
                </span>
                <bdi className="text-base font-semibold">{money(one.rate, language)}</bdi>
              </button>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

function RoomPanel({
  room,
  rooms,
  configuration,
  t,
  tt,
  readOnly,
  onClose,
  onChanged,
}: {
  room: Room;
  rooms: Room[];
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const language = configuration.language.app;
  const title = fill(tt.room, { n: room.number });
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issue, setIssue] = useState("");
  const [who, setWho] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const loadIssues = useCallback(() => {
    void machine.roomIssues(room.id).then((answer) => answer.ok && setIssues(answer.value));
  }, [room.id]);
  useEffect(loadIssues, [loadIssues]);

  if ((room.state === "occupied" || room.state === "reserved") && room.stayId) {
    return (
      <StayPanel
        stayId={room.stayId}
        title={title}
        rooms={rooms}
        configuration={configuration}
        t={t}
        tt={tt}
        readOnly={readOnly}
        onClose={onClose}
        onChanged={onChanged}
      />
    );
  }
  const said = (answer: { ok: boolean; reason?: string }) => {
    setProblem(answer.ok ? null : answer.reason === "read_only" ? t.readOnly : t.notSaved);
    return answer.ok;
  };
  const open = issues.filter((one) => one.status === "open");

  return (
    <Panel title={title} onClose={onClose} closeLabel={t.close}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-base text-ink-3">{[room.kind, room.floor !== null ? fill(tt.floorN, { n: room.floor }) : null].filter(Boolean).join(" · ")}</span>
        <StateBadge state={room.state} tt={tt} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {room.state === "cleaning" || room.state === "maintenance" || room.state === "out_of_service" ? (
          <Button kind="primary" disabled={readOnly || open.length > 0} onClick={() => void machine.setRoomStatus(room.id, "available").then(onChanged)}>
            {room.state === "cleaning" ? tt.markClean : tt.markBack}
          </Button>
        ) : null}
        {room.state !== "out_of_service" ? (
          <Button kind="quiet" disabled={readOnly} onClick={() => void machine.setRoomStatus(room.id, "out_of_service").then(onChanged)}>
            {tt.markOut}
          </Button>
        ) : null}
      </div>

      {issues.length > 0 ? (
        <section className="mt-6">
          <h3 className="text-lg font-semibold">{tt.issuesTitle}</h3>
          <ul className="mt-2 divide-y divide-line rounded-lg border-2 border-line">
            {issues.map((one) => (
              <li key={one.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className={`text-base font-semibold ${one.status === "resolved" ? "text-ink-3 line-through" : ""}`}>{one.issue}</div>
                  <div className="text-base text-ink-3">
                    {one.assignedTo ?? tt.unassigned} · <bdi>{when(one.createdAt, language)}</bdi>
                  </div>
                </div>
                {one.status === "open" ? (
                  <Button disabled={readOnly} onClick={() => void machine.resolveIssue(one.id, null).then((answer) => said(answer) && onChanged())}>
                    {tt.resolveIssue}
                  </Button>
                ) : (
                  <span className="text-base text-success">{fill(tt.resolvedOn, { date: when(one.resolvedAt ?? one.createdAt, language) })}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 space-y-3 rounded-lg border-2 border-line p-3">
        <h3 className="text-lg font-semibold">{tt.setMaintenance}</h3>
        <Field label={tt.issueLabel} value={issue} onChange={setIssue} placeholder={tt.issuePlaceholder} />
        <Field label={tt.assignedTo} value={who} onChange={setWho} />
        <Button
          disabled={readOnly || !issue.trim()}
          onClick={() =>
            void machine.reportIssue({ roomId: room.id, issue, assignedTo: who }).then((answer) => {
              if (!said(answer)) return;
              setIssue("");
              setWho("");
              onChanged();
            })
          }
        >
          {tt.reportIssue}
        </Button>
      </section>
      {problem ? (
        <div className="mt-3">
          <Notice kind="problem" text={problem} />
        </div>
      ) : null}

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
  rooms,
  configuration,
  t,
  tt,
  readOnly,
  onClose,
  onChanged,
}: {
  stayId: string;
  title: string;
  rooms: Room[];
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Panel title={title} onClose={onClose} closeLabel={t.close}>
      <StayView stayId={stayId} rooms={rooms} configuration={configuration} t={t} tt={tt} readOnly={readOnly} onChanged={onChanged} />
    </Panel>
  );
}

/*
 * One stay, as the hotel app's room panel showed it: since when the room is
 * taken, the guest and the dates, the services asked for, the balance with
 * the bill to look over, and what to do next.
 */
function StayView({
  stayId,
  rooms,
  configuration,
  t,
  tt,
  readOnly,
  onChanged,
}: {
  stayId: string;
  rooms: Room[];
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
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
  const [editing, setEditing] = useState(false);
  const [leaves, setLeaves] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [refund, setRefund] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    void machine.folio(stayId).then((answer) => {
      if (!answer.ok) return;
      setFolio(answer.value);
      setLeaves(answer.value.stay.leavesOn);
    });
  }, [stayId]);
  useEffect(() => {
    load();
    setPaying(false);
    setEditing(false);
    void machine.products().then(setExtras);
  }, [load]);

  if (!folio) return null;
  const stay: Stay = folio.stay;
  const services = folio.lines.filter((line) => line.kind === "service");
  const said = (answer: { ok: boolean; reason?: string }) => {
    setProblem(answer.ok ? null : answer.reason === "room taken" ? tt.roomTaken : answer.reason === "read_only" ? t.readOnly : t.notSaved);
    return answer.ok;
  };

  const addExtra = async (label: string, unitPrice: number, quantity = 1) => {
    said(await machine.addCharge({ stayId, label, unitPrice, quantity }));
    load();
  };

  return (
    <div>
      <div
        className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 ${
          stay.status === "in" ? "bg-accent text-accent-foreground" : stay.status === "reserved" ? "bg-warning-soft text-warning" : "bg-hover text-ink-2"
        }`}
      >
        <span className="text-lg font-semibold">
          {stay.status === "in"
            ? fill(tt.occupiedSince, { date: day(stay.checkedInAt ? stay.checkedInAt.slice(0, 10) : stay.arrivesOn, language) })
            : stay.status === "reserved"
              ? fill(tt.arrivalOn, { date: day(stay.arrivesOn, language) })
              : stay.status === "out"
                ? tt.stayOut
                : tt.stayCancelled}
        </span>
        <bdi className="text-base">{fill(tt.room, { n: stay.roomNumber })}</bdi>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-base">
        <Detail label={tt.guest} value={stay.guest} strong />
        <Detail label={tt.guestsCount} value={String(stay.adults)} />
        <Detail label={tt.arrivesOn} value={day(stay.arrivesOn, language)} />
        <Detail label={tt.leavesOn} value={day(stay.leavesOn, language)} />
        {stay.phone ? <Detail label={tt.phone} value={stay.phone} ltr /> : null}
        {stay.idDocument ? <Detail label={tt.idDocument} value={stay.idDocument} ltr /> : null}
      </dl>

      <section className="mt-5">
        <h3 className="text-lg font-semibold">{tt.servicesRequested}</h3>
        {services.length === 0 ? (
          <p className="mt-1 text-base text-ink-3">{tt.noServices}</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {services.map((line, index) => (
              <span key={index} className="rounded-md bg-hover px-2 py-1 text-base">
                {line.label}
                {line.quantity !== 1 ? ` (×${line.quantity})` : ""}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border-2 border-line bg-raised p-4">
        <div>
          <div className="text-base text-ink-3">{tt.currentBalance}</div>
          <bdi className={`text-3xl font-bold ${folio.balance > 0 ? "text-danger" : "text-success"}`}>{money(Math.max(0, folio.balance), language)}</bdi>
          <div className="text-base text-ink-3">
            {t.total} <bdi>{money(folio.total, language)}</bdi>
            {folio.received > 0 ? <> · {fill(tt.received, { amount: money(folio.received, language) })}</> : null}
          </div>
        </div>
        <Button onClick={() => void machine.printFolio(stayId)}>{tt.printIt}</Button>
      </div>

      <details className="mt-3">
        <summary className="flex min-h-[44px] cursor-pointer items-center text-base text-ink-2">{tt.folio}</summary>
        <ul className="mt-1">
          {folio.lines.map((line, index) => (
            <li key={index} className="flex justify-between gap-3 border-b border-line py-2 text-base">
              <span>
                {line.label}
                {line.kind === "service" && line.quantity !== 1 ? ` × ${line.quantity}` : ""}
              </span>
              <bdi>{money(line.total, language)}</bdi>
            </li>
          ))}
        </ul>
      </details>
      {problem ? (
        <div className="mt-3">
          <Notice kind="problem" text={problem} />
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {stay.status === "reserved" ? (
          <div className="flex flex-wrap gap-2">
            <Button kind="primary" big disabled={readOnly} onClick={() => void machine.checkIn(stayId).then((answer) => said(answer) && onChanged())}>
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
        {stay.status === "in" || stay.status === "reserved" ? (
          editing ? (
            <div className="space-y-3 rounded-lg border-2 border-line p-3">
              <Field label={tt.newDeparture} value={leaves} onChange={setLeaves} kind="date" />
              <label className="block">
                <span className="text-base text-ink-2">{tt.moveRoom}</span>
                <select
                  value={moveTo}
                  onChange={(event) => setMoveTo(event.target.value)}
                  className="mt-1 block min-h-[48px] w-full rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink"
                >
                  <option value="">{tt.sameRoom}</option>
                  {rooms
                    .filter((one) => one.id !== stay.roomId && one.state === "available")
                    .map((one) => (
                      <option key={one.id} value={one.id}>
                        {fill(tt.room, { n: one.number })}
                        {one.kind ? ` · ${one.kind}` : ""}
                      </option>
                    ))}
                </select>
              </label>
              <div className="flex gap-2">
                <Button onClick={() => setEditing(false)}>{t.cancel}</Button>
                <Button
                  kind="primary"
                  disabled={readOnly || (!moveTo && leaves === stay.leavesOn)}
                  onClick={() =>
                    void machine.editStay(stayId, { leavesOn: leaves, ...(moveTo ? { roomId: moveTo } : {}) }).then((answer) => {
                      if (!said(answer)) return;
                      setEditing(false);
                      setMoveTo("");
                      onChanged();
                    })
                  }
                >
                  {t.save}
                </Button>
              </div>
            </div>
          ) : (
            <Button wide disabled={readOnly} onClick={() => setEditing(true)}>
              {tt.editStay}
            </Button>
          )
        ) : null}
      </div>

      {stay.status === "in" && features?.extras !== false ? (
        <div className="mt-5 rounded-lg border-2 border-line p-3">
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

      {features?.advances !== false && (stay.status === "in" || stay.status === "reserved") ? (
        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <Field label={tt.takeAdvance} value={advance} onChange={setAdvance} kind="amount" />
          </div>
          <Button
            disabled={readOnly || !parseMoney(advance)}
            onClick={() => void machine.addAdvance(stayId, parseMoney(advance) as number, "cash").then((answer) => { said(answer); setAdvance(""); load(); })}
          >
            {t.payCash}
          </Button>
          <Button
            disabled={readOnly || !parseMoney(advance)}
            onClick={() => void machine.addAdvance(stayId, parseMoney(advance) as number, "mobile").then((answer) => { said(answer); setAdvance(""); load(); })}
          >
            {t.payMobile}
          </Button>
        </div>
      ) : null}

      {cancelling ? (
        <Confirm
          title={tt.cancelStay}
          body={folio.received > 0 ? tt.cancelStayBody : undefined}
          yes={tt.cancelStay}
          no={tt.back}
          onNo={() => setCancelling(false)}
          onYes={() => {
            setCancelling(false);
            void machine.cancelStay(stayId, refund).then((answer) => said(answer) && onChanged());
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
    </div>
  );
}

function Detail({ label, value, strong, ltr }: { label: string; value: string; strong?: boolean; ltr?: boolean }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className={strong ? "text-lg font-semibold" : ""}>
        <bdi dir={ltr ? "ltr" : undefined}>{value}</bdi>
      </dd>
    </div>
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
      <div className="mt-5 grid grid-cols-2 gap-3 rounded-lg border-2 border-line p-3">
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
    <li className="flex items-end justify-between gap-3 border-b border-line py-2">
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

/*
 * Bookings, as the hotel app listed them: every stay on the left, searched
 * and filtered by its state and by whether it is paid, and the one chosen
 * open on the right.
 */
export function Stays({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const language = configuration.language.app;
  const [lines, setLines] = useState<StayLine[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("");
  const [paid, setPaid] = useState("");
  const reload = useCallback(() => {
    void machine.stayLines().then((answer) => answer.ok && setLines(answer.value));
    void machine.rooms().then((answer) => answer.ok && setRooms(answer.value));
  }, []);
  useEffect(reload, [reload]);

  const statusName = (value: Stay["status"]) => ({ reserved: tt.stayReserved, in: tt.stayIn, out: tt.stayOut, cancelled: tt.stayCancelled })[value];
  const paidName = (value: StayLine["paid"]) => ({ unpaid: tt.paidUnpaid, partial: tt.paidPartial, paid: tt.paidPaid })[value];
  const paidLook = (value: StayLine["paid"]) => ({ unpaid: "bg-danger-soft text-danger", partial: "bg-warning-soft text-warning", paid: "bg-success-soft text-success" })[value];
  const needle = term.trim().toLocaleLowerCase();
  const shown = lines.filter(
    (line) =>
      (!needle || line.guest.toLocaleLowerCase().includes(needle) || line.roomNumber.toLocaleLowerCase().includes(needle)) &&
      (!status || line.status === status) &&
      (!paid || line.paid === paid)
  );

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.staysTitle}>
        <span className="text-base text-ink-3">{fill(tt.staysCount, { count: lines.length })}</span>
      </ScreenHeader>
      <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={tt.searchStays}
          aria-label={tt.searchStays}
          className="min-h-[48px] min-w-[220px] flex-1 rounded-lg border-2 border-line-strong px-4 text-base outline-none focus:border-ink"
        />
        <Filter
          label={tt.allStayStates}
          value={status}
          onChange={setStatus}
          options={(["reserved", "in", "out", "cancelled"] as Stay["status"][]).map((value) => ({ value, label: statusName(value) }))}
        />
        <Filter
          label={tt.allPaid}
          value={paid}
          onChange={setPaid}
          options={(["unpaid", "partial", "paid"] as StayLine["paid"][]).map((value) => ({ value, label: paidName(value) }))}
        />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[400px_1fr] gap-4 px-6 py-4">
        <div className="min-h-0 overflow-y-auto rounded-xl border-2 border-line bg-surface">
          {shown.length === 0 ? (
            <Empty title={tt.noStays} />
          ) : (
            <ul>
              {shown.map((line) => (
                <li key={line.id}>
                  <button
                    type="button"
                    onClick={() => setChosen(line.id)}
                    className={`flex w-full flex-col gap-1 border-b border-line px-4 py-3 text-start hover:bg-hover ${chosen === line.id ? "bg-selected" : ""}`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-lg font-semibold">{line.guest}</span>
                      <bdi className="text-base font-semibold">{money(line.total, language)}</bdi>
                    </span>
                    <span className="text-base text-ink-3">
                      {fill(tt.room, { n: line.roomNumber })} · {day(line.arrivesOn, language)} {language === "ar" ? "←" : "→"} {day(line.leavesOn, language)}
                    </span>
                    <span className="flex gap-2">
                      <span className="rounded-md bg-hover px-2 text-base">{statusName(line.status)}</span>
                      {line.status !== "cancelled" ? <span className={`rounded-md px-2 text-base font-semibold ${paidLook(line.paid)}`}>{paidName(line.paid)}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto rounded-xl border-2 border-line bg-surface p-5">
          {chosen ? (
            <StayView
              stayId={chosen}
              rooms={rooms}
              configuration={configuration}
              t={t}
              tt={tt}
              readOnly={readOnly}
              onChanged={reload}
            />
          ) : (
            <Empty title={tt.selectStay} body={tt.selectStayHint} />
          )}
        </div>
      </div>
    </div>
  );
}
