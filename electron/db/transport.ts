import type Database from "better-sqlite3";
import { audit } from "./audit";
import { stamp } from "./rows";
import { recordSale, voidSale, type NewSale } from "./sales";
import { clock } from "./clock";

/*
 * A transport company's counter: routes, the trips on them, seats sold to
 * passengers, and parcels sent from one town to another.
 *
 * Kept from the old parcels system: routes with a fare, vehicles with their
 * seats, trips with a driver, bookings by seat with the passenger's name and
 * phone, parcels with a tracking code, sender and receiver, and the manifest
 * printed before the bus leaves. Changed: every ticket and every parcel fee
 * is a sale, so a transport company's takings, its drawer at closing and its
 * reports work exactly like any other shop's, and a cancelled ticket is a
 * voided sale with its reason, never a row that quietly disappears.
 */

function blank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

export type Route = { id: string; origin: string; destination: string; fare: number; parcelFee: number | null };
export type Vehicle = { id: string; plate: string; seats: number };

export function listRoutes(database: Database.Database): Route[] {
  const rows = database
    .prepare("select id, origin, destination, fare, parcel_fee from routes where archived_at is null order by origin, destination")
    .all() as { id: string; origin: string; destination: string; fare: number; parcel_fee: number | null }[];
  return rows.map((row) => ({ id: row.id, origin: row.origin, destination: row.destination, fare: row.fare, parcelFee: row.parcel_fee }));
}

export function addRoute(
  database: Database.Database,
  deviceId: string,
  input: { origin: string; destination: string; fare: number; parcelFee?: number | null }
): string {
  const origin = blank(input.origin);
  const destination = blank(input.destination);
  if (!origin || !destination) throw new Error("a route needs both towns");
  if (!Number.isInteger(input.fare) || input.fare < 0) throw new Error("a fare is a whole number of minor units");
  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into routes (id, device_id, created_at, counter, origin, destination, fare, parcel_fee)
       values (@id, @device_id, @created_at, @counter, @origin, @destination, @fare, @parcel_fee)`
    )
    .run({ ...row, origin, destination, fare: input.fare, parcel_fee: input.parcelFee ?? null });
  return row.id;
}

export function updateRoute(database: Database.Database, id: string, input: { fare?: number; parcelFee?: number | null }): void {
  const current = database.prepare("select fare, parcel_fee from routes where id = ?").get(id) as { fare: number; parcel_fee: number | null } | undefined;
  if (!current) throw new Error("no such route");
  database
    .prepare("update routes set fare = ?, parcel_fee = ? where id = ?")
    .run(input.fare ?? current.fare, input.parcelFee !== undefined ? input.parcelFee : current.parcel_fee, id);
}

export function listVehicles(database: Database.Database): Vehicle[] {
  return database.prepare("select id, plate, seats from vehicles where archived_at is null order by plate").all() as Vehicle[];
}

export function addVehicle(database: Database.Database, deviceId: string, input: { plate: string; seats: number }): string {
  const plate = blank(input.plate);
  if (!plate) throw new Error("a vehicle needs its plate");
  if (!Number.isInteger(input.seats) || input.seats < 1) throw new Error("a vehicle has seats");
  const row = stamp(database, deviceId);
  database
    .prepare("insert into vehicles (id, device_id, created_at, counter, plate, seats) values (@id, @device_id, @created_at, @counter, @plate, @seats)")
    .run({ ...row, plate, seats: input.seats });
  return row.id;
}

export type Trip = {
  id: string;
  routeId: string;
  origin: string;
  destination: string;
  fare: number;
  vehicleId: string | null;
  plate: string | null;
  driver: string | null;
  departsAt: string;
  seats: number;
  sold: number;
  parcels: number;
  status: "scheduled" | "departed" | "arrived" | "cancelled";
};

const TRIP = `
  select t.id, t.route_id, r.origin, r.destination, r.fare, t.vehicle_id, v.plate, t.driver, t.departs_at, t.seats, t.status,
         (select count(*) from tickets k where k.trip_id = t.id and k.status != 'cancelled') as sold,
         (select count(*) from parcels p where p.trip_id = t.id and p.status != 'cancelled') as parcels
    from trips t
    join routes r on r.id = t.route_id
    left join vehicles v on v.id = t.vehicle_id
`;

type TripRow = {
  id: string;
  route_id: string;
  origin: string;
  destination: string;
  fare: number;
  vehicle_id: string | null;
  plate: string | null;
  driver: string | null;
  departs_at: string;
  seats: number;
  status: Trip["status"];
  sold: number;
  parcels: number;
};

function toTrip(row: TripRow): Trip {
  return {
    id: row.id,
    routeId: row.route_id,
    origin: row.origin,
    destination: row.destination,
    fare: row.fare,
    vehicleId: row.vehicle_id,
    plate: row.plate,
    driver: row.driver,
    departsAt: row.departs_at,
    seats: row.seats,
    sold: row.sold,
    parcels: row.parcels,
    status: row.status,
  };
}

export function tripsBetween(database: Database.Database, from: string, to: string): Trip[] {
  const rows = database.prepare(`${TRIP} where t.departs_at >= ? and t.departs_at < ? order by t.departs_at`).all(from, to) as TripRow[];
  return rows.map(toTrip);
}

export function getTrip(database: Database.Database, id: string): Trip | null {
  const row = database.prepare(`${TRIP} where t.id = ?`).get(id) as TripRow | undefined;
  return row ? toTrip(row) : null;
}

/* A departure on a route, with the vehicle's seats unless told otherwise. */
export function scheduleTrip(
  database: Database.Database,
  deviceId: string,
  input: { routeId: string; vehicleId?: string | null; driver?: string | null; departsAt: string; seats?: number }
): string {
  const vehicle = input.vehicleId
    ? (database.prepare("select seats from vehicles where id = ?").get(input.vehicleId) as { seats: number } | undefined)
    : undefined;
  const seats = input.seats ?? vehicle?.seats;
  if (!seats || seats < 1) throw new Error("a trip needs its seats");
  if (Number.isNaN(new Date(input.departsAt).getTime())) throw new Error("a departure needs its time");
  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into trips (id, device_id, created_at, counter, route_id, vehicle_id, driver, departs_at, seats)
       values (@id, @device_id, @created_at, @counter, @route_id, @vehicle_id, @driver, @departs_at, @seats)`
    )
    .run({
      ...row,
      route_id: input.routeId,
      vehicle_id: input.vehicleId ?? null,
      driver: blank(input.driver),
      departs_at: new Date(input.departsAt).toISOString(),
      seats,
    });
  return row.id;
}

/*
 * The bus left, arrived, or will not run. On arrival, its parcels are at the
 * destination, waiting for their receivers.
 */
export function setTripStatus(
  database: Database.Database,
  deviceId: string,
  tripId: string,
  status: "departed" | "arrived" | "cancelled",
  staffId: string | null = null
): void {
  const write = database.transaction(() => {
    const trip = getTrip(database, tripId);
    if (!trip) throw new Error("no such trip");
    if (status === "cancelled" && trip.sold > 0) throw new Error("trip has passengers");
    database.prepare("update trips set status = ? where id = ?").run(status, tripId);
    if (status === "departed") {
      database.prepare("update parcels set status = 'loaded' where trip_id = ? and status = 'received'").run(tripId);
    }
    if (status === "arrived") {
      database.prepare("update parcels set status = 'arrived' where trip_id = ? and status in ('received', 'loaded')").run(tripId);
    }
    audit(database, deviceId, { staffId, subject: "trip", subjectId: tripId, action: status });
  });
  write();
}

export type Ticket = {
  id: string;
  number: number;
  tripId: string;
  seat: number | null;
  passenger: string;
  phone: string | null;
  fare: number;
  status: "sold" | "boarded" | "cancelled";
  saleId: string | null;
};

export function ticketsOf(database: Database.Database, tripId: string): Ticket[] {
  const rows = database
    .prepare("select * from tickets where trip_id = ? order by seat, number")
    .all(tripId) as { id: string; number: number; trip_id: string; seat: number | null; passenger: string; phone: string | null; fare: number; status: Ticket["status"]; sale_id: string | null }[];
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    tripId: row.trip_id,
    seat: row.seat,
    passenger: row.passenger,
    phone: row.phone,
    fare: row.fare,
    status: row.status,
    saleId: row.sale_id,
  }));
}

/*
 * A seat sold. Refused when the seat is taken or the bus is full, because
 * two passengers holding the same seat number is a fight at the door.
 */
export function sellTicket(
  database: Database.Database,
  deviceId: string,
  input: {
    tripId: string;
    seat?: number | null;
    passenger: string;
    phone?: string | null;
    fare?: number;
    payment: Omit<NewSale, "lines" | "reference">;
    label: (trip: Trip, seat: number | null) => string;
    staffId?: string | null;
  },
  now = clock()
): { ticketId: string; number: number; saleId: string; saleNumber: number; change: number | null } {
  const passenger = blank(input.passenger);
  if (!passenger) throw new Error("a ticket needs the passenger's name");
  const write = database.transaction(() => {
    const trip = getTrip(database, input.tripId);
    if (!trip) throw new Error("no such trip");
    if (trip.status === "cancelled" || trip.status === "arrived") throw new Error("trip closed");
    if (trip.sold >= trip.seats) throw new Error("trip full");
    const seat = input.seat ?? null;
    if (seat !== null) {
      if (seat < 1 || seat > trip.seats) throw new Error("no such seat");
      const taken = database.prepare("select id from tickets where trip_id = ? and seat = ? and status != 'cancelled'").get(trip.id, seat);
      if (taken) throw new Error("seat taken");
    }
    const fare = input.fare ?? trip.fare;
    const row = stamp(database, deviceId);
    const number = (database.prepare("select coalesce(max(number), 0) + 1 as n from tickets").get() as { n: number }).n;
    const sale = recordSale(
      database,
      deviceId,
      { ...input.payment, reference: row.id, lines: [{ label: input.label(trip, seat), kind: "ticket", quantity: 1, unitPrice: fare, reference: row.id }] },
      now
    );
    database
      .prepare(
        `insert into tickets (id, device_id, created_at, counter, number, trip_id, seat, passenger, phone, fare, sale_id, staff_id)
         values (@id, @device_id, @created_at, @counter, @number, @trip_id, @seat, @passenger, @phone, @fare, @sale_id, @staff_id)`
      )
      .run({ ...row, number, trip_id: trip.id, seat, passenger, phone: blank(input.phone), fare, sale_id: sale.id, staff_id: input.staffId ?? null });
    return { ticketId: row.id, number, saleId: sale.id, saleNumber: sale.number, change: sale.change };
  });
  return write();
}

export function boardTicket(database: Database.Database, ticketId: string): void {
  database.prepare("update tickets set status = 'boarded' where id = ? and status = 'sold'").run(ticketId);
}

/* A ticket cancelled is its sale voided, with the reason, and the seat free again. */
export function cancelTicket(
  database: Database.Database,
  deviceId: string,
  ticketId: string,
  reason: string,
  staffId: string | null = null
): void {
  const write = database.transaction(() => {
    const ticket = database.prepare("select status, sale_id from tickets where id = ?").get(ticketId) as
      | { status: string; sale_id: string | null }
      | undefined;
    if (!ticket || ticket.status === "cancelled") throw new Error("no such ticket");
    if (ticket.sale_id) voidSale(database, deviceId, ticket.sale_id, reason, staffId);
    database.prepare("update tickets set status = 'cancelled' where id = ?").run(ticketId);
  });
  write();
}

export type Parcel = {
  id: string;
  code: string;
  tripId: string | null;
  routeId: string | null;
  destination: string | null;
  sender: string;
  senderPhone: string | null;
  receiver: string;
  receiverPhone: string | null;
  description: string | null;
  weight: number | null;
  fee: number;
  paidBy: "sender" | "receiver";
  paid: boolean;
  status: "received" | "loaded" | "arrived" | "delivered" | "cancelled";
  createdAt: string;
  deliveredAt: string | null;
};

const PARCEL = `select p.*, r.destination as route_destination from parcels p left join routes r on r.id = p.route_id`;

type ParcelRow = {
  id: string;
  code: string;
  trip_id: string | null;
  route_id: string | null;
  route_destination: string | null;
  sender: string;
  sender_phone: string | null;
  receiver: string;
  receiver_phone: string | null;
  description: string | null;
  weight: number | null;
  fee: number;
  paid_by: "sender" | "receiver";
  status: Parcel["status"];
  sale_id: string | null;
  created_at: string;
  delivered_at: string | null;
};

function toParcel(row: ParcelRow): Parcel {
  return {
    id: row.id,
    code: row.code,
    tripId: row.trip_id,
    routeId: row.route_id,
    destination: row.route_destination,
    sender: row.sender,
    senderPhone: row.sender_phone,
    receiver: row.receiver,
    receiverPhone: row.receiver_phone,
    description: row.description,
    weight: row.weight,
    fee: row.fee,
    paidBy: row.paid_by,
    paid: row.sale_id !== null,
    status: row.status,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

export function listParcels(database: Database.Database, which: "open" | "all" = "open", term = ""): Parcel[] {
  const clean = term.trim().toLowerCase();
  const where = [
    which === "open" ? "p.status not in ('delivered', 'cancelled')" : "1 = 1",
    clean ? "(lower(p.code) like @like or lower(p.sender) like @like or lower(p.receiver) like @like or p.sender_phone like @like or p.receiver_phone like @like)" : "1 = 1",
  ].join(" and ");
  const rows = database.prepare(`${PARCEL} where ${where} order by p.created_at desc limit 300`).all(clean ? { like: `%${clean}%` } : {}) as ParcelRow[];
  return rows.map(toParcel);
}

export function parcelsOf(database: Database.Database, tripId: string): Parcel[] {
  const rows = database.prepare(`${PARCEL} where p.trip_id = ? and p.status != 'cancelled' order by p.created_at`).all(tripId) as ParcelRow[];
  return rows.map(toParcel);
}

/* A short code the receiver can read out over the phone: P, the date, a number. */
function parcelCode(database: Database.Database, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const prefix = `P${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const count = (database.prepare("select count(*) as n from parcels where code like ?").get(`${prefix}%`) as { n: number }).n;
  return `${prefix}-${String(count + 1).padStart(3, "0")}`;
}

/*
 * A parcel handed in. Paid now by the sender, it is a sale now; paid by the
 * receiver, the sale is written when he collects it.
 */
export function registerParcel(
  database: Database.Database,
  deviceId: string,
  input: {
    routeId: string;
    tripId?: string | null;
    sender: string;
    senderPhone?: string | null;
    receiver: string;
    receiverPhone?: string | null;
    description?: string | null;
    weight?: number | null;
    fee: number;
    paidBy: "sender" | "receiver";
    payment?: Omit<NewSale, "lines" | "reference">;
    label: (code: string) => string;
    staffId?: string | null;
  },
  now = clock()
): { id: string; code: string; saleId: string | null; saleNumber: number | null } {
  const sender = blank(input.sender);
  const receiver = blank(input.receiver);
  if (!sender || !receiver) throw new Error("a parcel needs its sender and its receiver");
  if (!Number.isInteger(input.fee) || input.fee < 0) throw new Error("a fee is a whole number of minor units");
  const write = database.transaction(() => {
    const row = stamp(database, deviceId);
    const code = parcelCode(database, now);
    let sale: { id: string; number: number } | null = null;
    if (input.paidBy === "sender" && input.fee > 0) {
      sale = recordSale(
        database,
        deviceId,
        {
          ...(input.payment ?? { payment: "cash" }),
          reference: row.id,
          lines: [{ label: input.label(code), kind: "parcel", quantity: 1, unitPrice: input.fee, reference: row.id }],
        },
        now
      );
    }
    database
      .prepare(
        `insert into parcels (id, device_id, created_at, counter, code, trip_id, route_id, sender, sender_phone, receiver, receiver_phone,
                              description, weight, fee, paid_by, sale_id, staff_id)
         values (@id, @device_id, @created_at, @counter, @code, @trip_id, @route_id, @sender, @sender_phone, @receiver, @receiver_phone,
                 @description, @weight, @fee, @paid_by, @sale_id, @staff_id)`
      )
      .run({
        ...row,
        code,
        trip_id: input.tripId ?? null,
        route_id: input.routeId,
        sender,
        sender_phone: blank(input.senderPhone),
        receiver,
        receiver_phone: blank(input.receiverPhone),
        description: blank(input.description),
        weight: input.weight ?? null,
        fee: input.fee,
        paid_by: input.paidBy,
        sale_id: sale?.id ?? null,
        staff_id: input.staffId ?? null,
      });
    return { id: row.id, code, saleId: sale?.id ?? null, saleNumber: sale?.number ?? null };
  });
  return write();
}

export function loadParcel(database: Database.Database, parcelId: string, tripId: string): void {
  const result = database
    .prepare("update parcels set trip_id = ? where id = ? and status in ('received', 'loaded')")
    .run(tripId, parcelId);
  if (result.changes === 0) throw new Error("parcel not waiting");
}

export function markParcelArrived(database: Database.Database, parcelId: string): void {
  database.prepare("update parcels set status = 'arrived' where id = ? and status in ('received', 'loaded')").run(parcelId);
}

/* Handed to its receiver; if the fee was his to pay, it is a sale now. */
export function deliverParcel(
  database: Database.Database,
  deviceId: string,
  parcelId: string,
  payment: Omit<NewSale, "lines" | "reference"> | null,
  label: (code: string) => string,
  staffId: string | null = null,
  now = clock()
): { saleId: string | null; saleNumber: number | null } {
  const write = database.transaction(() => {
    const row = database.prepare(`${PARCEL} where p.id = ?`).get(parcelId) as ParcelRow | undefined;
    if (!row) throw new Error("no such parcel");
    if (row.status === "delivered" || row.status === "cancelled") throw new Error("parcel closed");
    let sale: { id: string; number: number } | null = null;
    if (!row.sale_id && row.fee > 0) {
      sale = recordSale(
        database,
        deviceId,
        {
          ...(payment ?? { payment: "cash" }),
          reference: parcelId,
          lines: [{ label: label(row.code), kind: "parcel", quantity: 1, unitPrice: row.fee, reference: parcelId }],
        },
        now
      );
    }
    database
      .prepare("update parcels set status = 'delivered', delivered_at = ?, sale_id = coalesce(sale_id, ?) where id = ?")
      .run(now.toISOString(), sale?.id ?? null, parcelId);
    audit(database, deviceId, { staffId, subject: "parcel", subjectId: parcelId, action: "delivered", detail: { code: row.code } });
    return { saleId: sale?.id ?? null, saleNumber: sale?.number ?? null };
  });
  return write();
}

export function cancelParcel(database: Database.Database, deviceId: string, parcelId: string, reason: string, staffId: string | null = null): void {
  const write = database.transaction(() => {
    const row = database.prepare("select status, sale_id from parcels where id = ?").get(parcelId) as { status: string; sale_id: string | null } | undefined;
    if (!row || row.status === "delivered" || row.status === "cancelled") throw new Error("parcel closed");
    if (row.sale_id) voidSale(database, deviceId, row.sale_id, reason, staffId);
    database.prepare("update parcels set status = 'cancelled' where id = ?").run(parcelId);
  });
  write();
}

/* Takings per route over a period: tickets and parcels, net of cancellations. */
export function routeTakings(database: Database.Database, from: string, to: string): { route: string; tickets: number; ticketTotal: number; parcels: number; parcelTotal: number }[] {
  const rows = database
    .prepare(
      `select r.origin || ' → ' || r.destination as route,
              (select count(*) from tickets k join trips t on t.id = k.trip_id
                 where t.route_id = r.id and k.status != 'cancelled' and k.created_at >= @from and k.created_at < @to) as tickets,
              (select coalesce(sum(k.fare), 0) from tickets k join trips t on t.id = k.trip_id
                 where t.route_id = r.id and k.status != 'cancelled' and k.created_at >= @from and k.created_at < @to) as ticket_total,
              (select count(*) from parcels p where p.route_id = r.id and p.status != 'cancelled' and p.created_at >= @from and p.created_at < @to) as parcels,
              (select coalesce(sum(p.fee), 0) from parcels p where p.route_id = r.id and p.status != 'cancelled' and p.created_at >= @from and p.created_at < @to) as parcel_total
         from routes r where r.archived_at is null order by r.origin, r.destination`
    )
    .all({ from, to }) as { route: string; tickets: number; ticket_total: number; parcels: number; parcel_total: number }[];
  return rows
    .map((row) => ({ route: row.route, tickets: row.tickets, ticketTotal: row.ticket_total, parcels: row.parcels, parcelTotal: row.parcel_total }))
    .filter((row) => row.tickets > 0 || row.parcels > 0);
}
