import { useCallback, useEffect, useState } from "react";
import type { AppLanguage, Configuration } from "@app-ui/config";
import { machine, type Issue, type Room, type Stay, type StayLine } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Empty, Field, Notice, Panel, ScreenHeader, day, money, moneyText, nameOr, parseMoney, parseQuantity, when, useDataTick } from "../ui";
import { EndOfDayButton } from "./end-of-day";
import { FILTERS_FROM, Filter, STATE_BAR, StateBadge, stateLabel } from "./hotel-shared";
import { StayPanel, StayView } from "./hotel-stay";
import { BookingForm, NewBooking } from "./hotel-booking";

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

  const dataTick = useDataTick();
  const reload = useCallback(() => {
    void machine.rooms().then((answer) => answer.ok && setRooms(answer.value));
  }, []);
  useEffect(reload, [reload, dataTick]);

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
        <EndOfDayButton configuration={configuration} t={t} tt={tt} />
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
                className="min-h-[48px] min-w-[220px] flex-1 max-md:min-w-0 max-md:basis-full rounded-lg border-2 border-line-strong px-4 text-base outline-none focus:border-ink"
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
                      room.state === "available" ? "bg-accent text-accent-foreground" : "border-2 border-line-strong"
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
          disabled={readOnly}
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
            disabled={readOnly || (rate.trim() !== "" && parseMoney(rate) === null)}
            onClick={() =>
              void machine.addRoom({ number, kind, rate: rate.trim() ? (parseMoney(rate) as number) : 0, capacity: parseQuantity(capacity) ?? 2 }).then((answer) => {
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
        <div className="w-[130px] max-md:w-full max-md:min-w-[8rem] max-md:flex-1">
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
  const dataTick = useDataTick();
  const reload = useCallback(() => {
    void machine.stayLines().then((answer) => answer.ok && setLines(answer.value));
    void machine.rooms().then((answer) => answer.ok && setRooms(answer.value));
  }, []);
  useEffect(reload, [reload, dataTick]);

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
          className="min-h-[48px] min-w-[220px] flex-1 max-md:min-w-0 max-md:basis-full rounded-lg border-2 border-line-strong px-4 text-base outline-none focus:border-ink"
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
      <div className="grid min-h-0 flex-1 grid-cols-[400px_1fr] max-md:grid-cols-1 max-md:px-4 gap-4 px-6 py-4">
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
                      <span className="text-lg font-semibold">{nameOr(t.noName, line.guest)}</span>
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
