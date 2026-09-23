import { useCallback, useEffect, useMemo, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type Parcel, type Route, type Ticket, type Trip, type Vehicle } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Choices, Confirm, Empty, Field, Notice, Panel, ScreenHeader, clock, day, localDay, money, moneyText, parseMoney, parseQuantity, when } from "../ui";
import { PaymentBox, paymentProblem } from "./payment";

/*
 * A transport company's counter. Departures by day, each with its seats: a
 * seat is tapped, the passenger's name and phone typed, the fare paid, the
 * ticket printed. Parcels have their own screen, because they are handed in
 * and collected at different times and by different people. Routes and
 * vehicles are set up once, on a third.
 */

function dayRange(offset: number): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function tripStatus(trip: Trip, tt: TradesCopy): string {
  return { scheduled: tt.scheduled, departed: tt.departed, arrived: tt.arrived, cancelled: tt.tripCancelled }[trip.status];
}

export function Trips({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const language = configuration.language.app;
  const [offset, setOffset] = useState(0);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => {
    const range = dayRange(offset);
    void machine.tripsBetween(range.from, range.to).then((answer) => answer.ok && setTrips(answer.value));
  }, [offset]);
  useEffect(reload, [reload]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.tripsTitle}>
        <Button kind="primary" disabled={readOnly} onClick={() => setCreating(true)}>
          {tt.newTrip}
        </Button>
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <Choices<string>
          value={String(offset)}
          onChange={(value) => setOffset(Number(value))}
          options={[0, 1, 2, 3, 4, 5, 6].map((index) => ({
            value: String(index),
            label: index === 0 ? tt.today : index === 1 ? tt.tomorrow : day(localDay(index), language),
          }))}
        />
        {trips.length === 0 ? (
          <Empty title={tt.noTrips} />
        ) : (
          <ul className="mt-4 space-y-3">
            {trips.map((trip) => (
              <li key={trip.id}>
                <button
                  type="button"
                  onClick={() => setOpen(trip.id)}
                  className={`flex w-full items-center justify-between gap-4 rounded-xl border-2 p-4 text-start ${trip.status === "cancelled" ? "border-black/10 opacity-50" : "border-black/15"}`}
                >
                  <span>
                    <span className="block text-xl font-semibold">
                      <bdi>{clock(trip.departsAt)}</bdi> · {trip.origin} → {trip.destination}
                    </span>
                    <span className="block text-base text-black/60">
                      {[trip.plate, trip.driver, tripStatus(trip, tt)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="text-end text-base">
                    <span className="block text-lg font-semibold">{fill(tt.seatsLeft, { count: Math.max(0, trip.seats - trip.sold) })}</span>
                    {trip.parcels > 0 ? <span className="block">{tt.parcelsTitle} : {trip.parcels}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating ? (
        <NewTrip
          t={t}
          tt={tt}
          defaultDay={localDay(offset)}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      ) : null}
      {open ? (
        <TripPanel
          id={open}
          configuration={configuration}
          t={t}
          tt={tt}
          readOnly={readOnly}
          onClose={() => {
            setOpen(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function NewTrip({ t, tt, defaultDay, onClose, onSaved }: { t: ScreensCopy; tt: TradesCopy; defaultDay: string; onClose: () => void; onSaved: () => void }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [routeId, setRouteId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driver, setDriver] = useState("");
  const [date, setDate] = useState(defaultDay);
  const [time, setTime] = useState("08:00");
  const [seats, setSeats] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void machine.routes().then((answer) => answer.ok && setRoutes(answer.value));
    void machine.vehicles().then((answer) => answer.ok && setVehicles(answer.value));
  }, []);

  async function save() {
    if (!routeId) return;
    const [hours, minutes] = time.split(":").map(Number);
    const [year, month, dayOfMonth] = date.split("-").map(Number);
    const departsAt = new Date(year, month - 1, dayOfMonth, hours || 0, minutes || 0).toISOString();
    const answer = await machine.scheduleTrip({
      routeId,
      vehicleId: vehicleId || null,
      driver,
      departsAt,
      seats: seats.trim() ? (parseQuantity(seats) ?? undefined) : undefined,
    });
    if (!answer.ok) {
      setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    onSaved();
  }

  return (
    <Panel
      title={tt.newTrip}
      onClose={onClose}
      closeLabel={t.close}
      footer={
        <div className="flex justify-end">
          <Button kind="primary" disabled={!routeId || (!vehicleId && !seats.trim())} onClick={() => void save()}>
            {t.save}
          </Button>
        </div>
      }
    >
      {routes.length === 0 ? <Notice kind="problem" text={tt.noRoutes} /> : null}
      <div className="space-y-3">
        <label className="block">
          <span className="text-base text-black/70">{tt.route}</span>
          <select value={routeId} onChange={(event) => setRouteId(event.target.value)} className="mt-1 min-h-[48px] w-full rounded-lg border-2 border-black/15 bg-white px-2 text-base">
            <option value="">{tt.choose}</option>
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.origin} → {route.destination}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-base text-black/70">{tt.vehicle}</span>
          <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className="mt-1 min-h-[48px] w-full rounded-lg border-2 border-black/15 bg-white px-2 text-base">
            <option value="">{tt.choose}</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plate} · {vehicle.seats}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tt.departsAt} value={date} onChange={setDate} kind="date" />
          <label className="block">
            <span className="text-base text-black/70">&nbsp;</span>
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} dir="ltr" className="mt-1 min-h-[48px] w-full rounded-lg border-2 border-black/15 px-3 text-base" />
          </label>
          <Field label={tt.driver} value={driver} onChange={setDriver} />
          <Field label={tt.seats} value={seats} onChange={setSeats} kind="number" />
        </div>
        {problem ? <Notice kind="problem" text={problem} /> : null}
      </div>
    </Panel>
  );
}

function TripPanel({
  id,
  configuration,
  t,
  tt,
  readOnly,
  onClose,
}: {
  id: string;
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
}) {
  const language = configuration.language.app;
  const features = configuration.features.transport;
  const numbered = features?.seatNumbers !== false;
  const carriesPassengers = (features?.carries ?? ["passengers"]).includes("passengers");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [seat, setSeat] = useState<number | null | undefined>(undefined);
  const [passenger, setPassenger] = useState("");
  const [phone, setPhone] = useState("");
  const [fare, setFare] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Ticket | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    void machine.tripDetail(id).then((answer) => {
      if (!answer.ok) return;
      setTrip(answer.value.trip);
      setTickets(answer.value.tickets);
      setParcels(answer.value.parcels);
      setFare(moneyText(answer.value.trip.fare));
    });
  }, [id]);
  useEffect(load, [load]);

  const taken = useMemo(() => new Map(tickets.filter((ticket) => ticket.status !== "cancelled" && ticket.seat).map((ticket) => [ticket.seat as number, ticket])), [tickets]);
  if (!trip) return null;
  const open = trip.status === "scheduled" || trip.status === "departed";
  const fareMinor = parseMoney(fare);

  const status = async (next: "departed" | "arrived" | "cancelled") => {
    const answer = await machine.setTripStatus(id, next);
    if (!answer.ok) setProblem(answer.reason === "trip has passengers" ? tt.hasPassengers : t.notSaved);
    load();
  };

  return (
    <Panel title={`${clock(trip.departsAt)} · ${trip.origin} → ${trip.destination}`} onClose={onClose} closeLabel={t.close}>
      <p className="text-base text-black/60">
        {[when(trip.departsAt, language), trip.plate, trip.driver, tripStatus(trip, tt)].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-1 text-lg font-semibold">{fill(tt.seatsLeft, { count: Math.max(0, trip.seats - trip.sold) })}</p>
      {note ? <div className="mt-3"><Notice kind="done" text={note} /></div> : null}
      {problem ? <div className="mt-3"><Notice kind="problem" text={problem} /></div> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void machine.printManifest(id)}>{tt.manifest}</Button>
        {trip.status === "scheduled" ? (
          <Button disabled={readOnly} onClick={() => void status("departed")}>
            {tt.markDeparted}
          </Button>
        ) : null}
        {trip.status === "departed" ? (
          <Button disabled={readOnly} onClick={() => void status("arrived")}>
            {tt.markArrived}
          </Button>
        ) : null}
        {trip.status === "scheduled" ? (
          <Button kind="quiet" disabled={readOnly} onClick={() => void status("cancelled")}>
            {tt.cancelTrip}
          </Button>
        ) : null}
      </div>

      {carriesPassengers ? (
        <>
          {numbered && open ? (
            <div className="mt-5 grid grid-cols-6 gap-2">
              {Array.from({ length: trip.seats }, (_, index) => index + 1).map((number) => {
                const ticket = taken.get(number);
                return (
                  <button
                    key={number}
                    type="button"
                    disabled={Boolean(ticket) || readOnly}
                    onClick={() => setSeat(number)}
                    className={`min-h-[52px] rounded-lg border-2 text-lg font-semibold ${
                      ticket ? "border-black bg-black text-white" : seat === number ? "border-black bg-black/10" : "border-black/15 bg-white"
                    }`}
                    title={ticket?.passenger}
                  >
                    <bdi>{number}</bdi>
                  </button>
                );
              })}
            </div>
          ) : null}
          {!numbered && open && trip.sold < trip.seats ? (
            <div className="mt-5">
              <Button onClick={() => setSeat(null)}>{tt.sellTicket}</Button>
            </div>
          ) : null}

          {seat !== undefined && open ? (
            <div className="mt-4 space-y-3 rounded-lg border-2 border-black p-4">
              <div className="text-lg font-semibold">{seat ? fill(tt.seat, { n: seat }) : tt.anySeat}</div>
              <Field label={tt.passenger} value={passenger} onChange={setPassenger} autoFocus />
              <div className="grid grid-cols-2 gap-3">
                <Field label={tt.phone} value={phone} onChange={setPhone} ltr />
                <Field label={tt.fare} value={fare} onChange={setFare} kind="amount" error={fareMinor === null ? t.badAmount : null} />
              </div>
              {passenger.trim() && fareMinor !== null ? (
                <PaymentBox
                  total={fareMinor}
                  t={t}
                  language={language}
                  creditEnabled={configuration.common.credit.enabled}
                  readOnly={readOnly}
                  actionLabel={tt.pay}
                  onPay={async (choice) => {
                    const answer = await machine.sellTicket({ tripId: id, seat, passenger, phone, fare: fareMinor, payment: choice });
                    if (!answer.ok) {
                      setProblem(answer.reason === "seat taken" ? tt.seatTaken : answer.reason === "trip full" ? tt.tripFull : paymentProblem(answer.reason, t));
                      return;
                    }
                    void machine.printReceipt(answer.value.saleId);
                    setNote(fill(tt.ticketSold, { number: answer.value.number }));
                    setProblem(null);
                    setSeat(undefined);
                    setPassenger("");
                    setPhone("");
                    load();
                  }}
                />
              ) : null}
              <Button kind="quiet" onClick={() => setSeat(undefined)}>
                {t.cancel}
              </Button>
            </div>
          ) : null}

          <h3 className="mt-6 text-lg font-semibold">{tt.tickets}</h3>
          <ul className="mt-2">
            {tickets
              .filter((ticket) => ticket.status !== "cancelled")
              .map((ticket) => (
                <li key={ticket.id} className="flex items-center justify-between gap-3 border-b border-black/10 py-2 text-base">
                  <span>
                    <b>{ticket.seat ? fill(tt.seat, { n: ticket.seat }) : tt.anySeat}</b> · {ticket.passenger}
                    {ticket.phone ? <> · <bdi dir="ltr">{ticket.phone}</bdi></> : null}
                    {ticket.status === "boarded" ? ` · ${tt.boarded}` : ""}
                  </span>
                  <span className="flex gap-1">
                    {ticket.status === "sold" ? (
                      <Button kind="quiet" disabled={readOnly} onClick={() => void machine.boardTicket(ticket.id).then(load)}>
                        {tt.board}
                      </Button>
                    ) : null}
                    {trip.status === "scheduled" ? (
                      <Button kind="quiet" disabled={readOnly} onClick={() => setCancelling(ticket)}>
                        {tt.cancelTicket}
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
          </ul>
        </>
      ) : null}

      {parcels.length > 0 ? (
        <>
          <h3 className="mt-6 text-lg font-semibold">{tt.parcelsTitle}</h3>
          <ul className="mt-2">
            {parcels.map((parcel) => (
              <li key={parcel.id} className="border-b border-black/10 py-2 text-base">
                <bdi className="font-semibold">{parcel.code}</bdi> · {parcel.receiver}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {cancelling ? (
        <Confirm
          title={tt.cancelTicket}
          yes={tt.cancelTicket}
          no={tt.back}
          onNo={() => setCancelling(null)}
          onYes={() => {
            if (!reason.trim()) return;
            const ticket = cancelling;
            setCancelling(null);
            void machine.cancelTicket(ticket.id, reason).then(() => {
              setReason("");
              load();
            });
          }}
        >
          <Field label={t.reason} value={reason} onChange={setReason} autoFocus />
        </Confirm>
      ) : null}
    </Panel>
  );
}

function parcelStatus(parcel: Parcel, tt: TradesCopy): string {
  return {
    received: tt.parcelReceived,
    loaded: tt.parcelLoaded,
    arrived: tt.parcelArrived,
    delivered: tt.parcelDelivered,
    cancelled: tt.parcelCancelled,
  }[parcel.status];
}

export function Parcels({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const language = configuration.language.app;
  const [term, setTerm] = useState("");
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Parcel | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(() => {
    void machine.parcels(term.trim() ? "all" : "open", term).then((answer) => answer.ok && setParcels(answer.value));
  }, [term]);
  useEffect(() => {
    const timer = setTimeout(reload, 150); // not-a-rule: typing delay
    return () => clearTimeout(timer);
  }, [reload]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.parcelsTitle}>
        <Button kind="primary" disabled={readOnly} onClick={() => setCreating(true)}>
          {tt.newParcel}
        </Button>
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {note ? <div className="mb-4"><Notice kind="done" text={note} /></div> : null}
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={tt.searchParcel}
          aria-label={tt.searchParcel}
          className="min-h-[48px] w-full rounded-lg border-2 border-black/15 px-4 text-base outline-none focus:border-black"
        />
        {parcels.length === 0 ? (
          <Empty title={tt.noParcels} />
        ) : (
          <ul className="mt-4">
            {parcels.map((parcel) => (
              <li key={parcel.id}>
                <button type="button" onClick={() => setOpen(parcel)} className="flex w-full items-start justify-between gap-3 border-b border-black/10 py-3 text-start hover:bg-black/5">
                  <span>
                    <bdi className="block text-lg font-semibold">{parcel.code}</bdi>
                    <span className="block text-base">
                      {parcel.sender} → {parcel.receiver}
                      {parcel.destination ? ` · ${parcel.destination}` : ""}
                    </span>
                  </span>
                  <span className="text-end text-base">
                    <span className="block font-semibold">{parcelStatus(parcel, tt)}</span>
                    <bdi className="block">{money(parcel.fee, language)}</bdi>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating ? (
        <NewParcel
          configuration={configuration}
          t={t}
          tt={tt}
          readOnly={readOnly}
          onClose={() => setCreating(false)}
          onSaved={(code) => {
            setCreating(false);
            setNote(fill(tt.parcelSaved, { code }));
            reload();
          }}
        />
      ) : null}
      {open ? (
        <ParcelPanel
          parcel={open}
          configuration={configuration}
          t={t}
          tt={tt}
          readOnly={readOnly}
          onClose={() => setOpen(null)}
          onChanged={(message) => {
            setOpen(null);
            if (message) setNote(message);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function NewParcel({
  configuration,
  t,
  tt,
  readOnly,
  onClose,
  onSaved,
}: {
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
  onSaved: (code: string) => void;
}) {
  const language = configuration.language.app;
  const payer = configuration.features.transport?.parcelPayer ?? "either";
  const [routes, setRoutes] = useState<Route[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [routeId, setRouteId] = useState("");
  const [tripId, setTripId] = useState("");
  const [sender, setSender] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [receiver, setReceiver] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [contents, setContents] = useState("");
  const [weight, setWeight] = useState("");
  const [fee, setFee] = useState("");
  const [paidBy, setPaidBy] = useState<"sender" | "receiver">(payer === "receiver" ? "receiver" : "sender");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void machine.routes().then((answer) => answer.ok && setRoutes(answer.value));
    const now = new Date();
    const later = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    void machine.tripsBetween(new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(), later.toISOString()).then(
      (answer) => answer.ok && setTrips(answer.value.filter((trip) => trip.status === "scheduled"))
    );
  }, []);

  const route = routes.find((one) => one.id === routeId);
  const feeMinor = parseMoney(fee);
  const ready = routeId && sender.trim() && receiver.trim() && feeMinor !== null;

  const register = async (payment?: Parameters<typeof machine.registerParcel>[0]["payment"]) => {
    if (!ready) return;
    const answer = await machine.registerParcel({
      routeId,
      tripId: tripId || null,
      sender,
      senderPhone,
      receiver,
      receiverPhone,
      description: contents,
      weight: weight.trim() ? parseQuantity(weight) : null,
      fee: feeMinor as number,
      paidBy,
      payment,
    });
    if (!answer.ok) {
      setProblem(paymentProblem(answer.reason, t));
      return;
    }
    void machine.printParcel(answer.value.id);
    onSaved(answer.value.code);
  };

  return (
    <Panel title={tt.newParcel} onClose={onClose} closeLabel={t.close}>
      <div className="space-y-3">
        <label className="block">
          <span className="text-base text-black/70">{tt.route}</span>
          <select
            value={routeId}
            onChange={(event) => {
              setRouteId(event.target.value);
              const chosen = routes.find((one) => one.id === event.target.value);
              if (chosen?.parcelFee) setFee(moneyText(chosen.parcelFee));
            }}
            className="mt-1 min-h-[48px] w-full rounded-lg border-2 border-black/15 bg-white px-2 text-base"
          >
            <option value="">{tt.choose}</option>
            {routes.map((one) => (
              <option key={one.id} value={one.id}>
                {one.origin} → {one.destination}
              </option>
            ))}
          </select>
        </label>
        {route ? (
          <label className="block">
            <span className="text-base text-black/70">{tt.onTrip}</span>
            <select value={tripId} onChange={(event) => setTripId(event.target.value)} className="mt-1 min-h-[48px] w-full rounded-lg border-2 border-black/15 bg-white px-2 text-base">
              <option value="">{tt.noTripYet}</option>
              {trips
                .filter((trip) => trip.routeId === routeId)
                .map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {when(trip.departsAt, language)}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label={tt.sender} value={sender} onChange={setSender} />
          <Field label={tt.senderPhone} value={senderPhone} onChange={setSenderPhone} ltr />
          <Field label={tt.receiver} value={receiver} onChange={setReceiver} />
          <Field label={tt.receiverPhone} value={receiverPhone} onChange={setReceiverPhone} ltr />
          <Field label={tt.contents} value={contents} onChange={setContents} />
          <Field label={tt.weight} value={weight} onChange={setWeight} kind="number" />
          <Field label={tt.fee} value={fee} onChange={setFee} kind="amount" error={fee.trim() && feeMinor === null ? t.badAmount : null} />
        </div>
        {payer === "either" ? (
          <div>
            <div className="mb-1 text-base text-black/70">{tt.whoPays}</div>
            <Choices<"sender" | "receiver">
              value={paidBy}
              onChange={setPaidBy}
              options={[
                { value: "sender", label: tt.paysSender },
                { value: "receiver", label: tt.paysReceiver },
              ]}
            />
          </div>
        ) : null}
        {problem ? <Notice kind="problem" text={problem} /> : null}
        {ready ? (
          paidBy === "sender" && (feeMinor as number) > 0 ? (
            <PaymentBox
              total={feeMinor as number}
              t={t}
              language={language}
              creditEnabled={configuration.common.credit.enabled}
              readOnly={readOnly}
              actionLabel={tt.pay}
              onPay={(choice) => register(choice)}
            />
          ) : (
            <Button kind="primary" big wide disabled={readOnly} onClick={() => void register()}>
              {t.save}
            </Button>
          )
        ) : null}
      </div>
    </Panel>
  );
}

function ParcelPanel({
  parcel,
  configuration,
  t,
  tt,
  readOnly,
  onClose,
  onChanged,
}: {
  parcel: Parcel;
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
  onChanged: (message?: string) => void;
}) {
  const language = configuration.language.app;
  const [paying, setPaying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const open = parcel.status !== "delivered" && parcel.status !== "cancelled";

  return (
    <Panel title={fill(tt.code, { code: parcel.code })} onClose={onClose} closeLabel={t.close}>
      <dl className="space-y-1 text-base">
        <div>
          <b>{tt.sender}</b> : {parcel.sender} {parcel.senderPhone ? <bdi dir="ltr">{parcel.senderPhone}</bdi> : null}
        </div>
        <div>
          <b>{tt.receiver}</b> : {parcel.receiver} {parcel.receiverPhone ? <bdi dir="ltr">{parcel.receiverPhone}</bdi> : null}
        </div>
        {parcel.destination ? <div>→ {parcel.destination}</div> : null}
        {parcel.description ? <div>{parcel.description}</div> : null}
        <div>
          <b>{tt.fee}</b> : <bdi>{money(parcel.fee, language)}</bdi> · {parcel.paidBy === "sender" ? tt.paysSender : tt.paysReceiver}
        </div>
        <div className="font-semibold">{parcelStatus(parcel, tt)}</div>
      </dl>
      {problem ? <div className="mt-3"><Notice kind="problem" text={problem} /></div> : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => void machine.printParcel(parcel.id)}>{tt.printSlip}</Button>
        {open && (parcel.status === "received" || parcel.status === "loaded") ? (
          <Button disabled={readOnly} onClick={() => void machine.parcelArrived(parcel.id).then(() => onChanged())}>
            {tt.arrivedHere}
          </Button>
        ) : null}
        {open ? (
          <Button kind="quiet" disabled={readOnly} onClick={() => setCancelling(true)}>
            {tt.cancelParcel}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-6">
          {!parcel.paid && parcel.fee > 0 ? (
            paying ? (
              <PaymentBox
                total={parcel.fee}
                t={t}
                language={language}
                creditEnabled={configuration.common.credit.enabled}
                readOnly={readOnly}
                actionLabel={tt.pay}
                problem={problem}
                onPay={async (choice) => {
                  const answer = await machine.deliverParcel(parcel.id, choice);
                  if (!answer.ok) setProblem(paymentProblem(answer.reason, t));
                  else onChanged(tt.parcelDone);
                }}
              />
            ) : (
              <Button kind="primary" big wide disabled={readOnly} onClick={() => setPaying(true)}>
                {tt.deliverPay}
              </Button>
            )
          ) : (
            <Button kind="primary" big wide disabled={readOnly} onClick={() => void machine.deliverParcel(parcel.id, null).then(() => onChanged(tt.parcelDone))}>
              {tt.deliver}
            </Button>
          )}
        </div>
      ) : null}
      {cancelling ? (
        <Confirm
          title={tt.cancelParcel}
          yes={tt.cancelParcel}
          no={tt.back}
          onNo={() => setCancelling(false)}
          onYes={() => {
            if (!reason.trim()) return;
            setCancelling(false);
            void machine.cancelParcel(parcel.id, reason).then(() => onChanged());
          }}
        >
          <Field label={t.reason} value={reason} onChange={setReason} autoFocus />
        </Confirm>
      ) : null}
    </Panel>
  );
}

/* The company's routes and vehicles, set up once and changed rarely. */
export function Network({ configuration, t, tt, readOnly }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean }) {
  const language = configuration.language.app;
  const [routes, setRoutes] = useState<Route[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [fare, setFare] = useState("");
  const [parcelFee, setParcelFee] = useState("");
  const [plate, setPlate] = useState("");
  const [seats, setSeats] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(() => {
    void machine.routes().then((answer) => answer.ok && setRoutes(answer.value));
    void machine.vehicles().then((answer) => answer.ok && setVehicles(answer.value));
  }, []);
  useEffect(reload, [reload]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.networkTitle} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {problem ? <div className="mb-4"><Notice kind="problem" text={problem} /></div> : null}
        <section className="max-w-3xl">
          <h2 className="text-xl font-semibold">{tt.navNetwork}</h2>
          <ul className="mt-2">
            {routes.map((route) => (
              <li key={route.id} className="flex justify-between border-b border-black/10 py-2 text-base">
                <span>
                  {route.origin} → {route.destination}
                </span>
                <span>
                  <bdi>{money(route.fare, language)}</bdi>
                  {route.parcelFee !== null ? <> · {tt.parcelsTitle} <bdi>{money(route.parcelFee, language)}</bdi></> : null}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label={tt.origin} value={origin} onChange={setOrigin} />
            <Field label={tt.destinationTown} value={destination} onChange={setDestination} />
            <Field label={tt.fare} value={fare} onChange={setFare} kind="amount" />
            <Field label={tt.parcelFee} value={parcelFee} onChange={setParcelFee} kind="amount" />
          </div>
          <div className="mt-3">
            <Button
              kind="primary"
              disabled={readOnly || !origin.trim() || !destination.trim() || parseMoney(fare) === null}
              onClick={() =>
                void machine
                  .addRoute({ origin, destination, fare: parseMoney(fare) as number, parcelFee: parcelFee.trim() ? parseMoney(parcelFee) : null })
                  .then((answer) => {
                    if (!answer.ok) setProblem(t.notSaved);
                    else {
                      setOrigin("");
                      setDestination("");
                      setFare("");
                      setParcelFee("");
                      reload();
                    }
                  })
              }
            >
              {tt.addRoute}
            </Button>
          </div>
        </section>

        <section className="mt-8 max-w-3xl">
          <h2 className="text-xl font-semibold">{tt.vehicle}</h2>
          <ul className="mt-2">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id} className="flex justify-between border-b border-black/10 py-2 text-base">
                <bdi>{vehicle.plate}</bdi>
                <span>
                  {tt.seats} : <bdi>{vehicle.seats}</bdi>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label={tt.plate} value={plate} onChange={setPlate} ltr />
            <Field label={tt.seats} value={seats} onChange={setSeats} kind="number" />
          </div>
          <div className="mt-3">
            <Button
              kind="primary"
              disabled={readOnly || !plate.trim() || !parseQuantity(seats)}
              onClick={() =>
                void machine.addVehicle({ plate, seats: parseQuantity(seats) as number }).then((answer) => {
                  if (!answer.ok) setProblem(t.notSaved);
                  else {
                    setPlate("");
                    setSeats("");
                    reload();
                  }
                })
              }
            >
              {tt.addVehicle}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
