import type Database from "better-sqlite3";
import { audit } from "./audit";
import { addCashMovement, receivedFor } from "./cashbook";
import { today } from "./products";
import { stamp } from "./rows";
import { recordSale, type NewSale, type RecordedSale } from "./sales";
import { clock } from "./clock";

/*
 * A hotel's front desk: rooms, the stays booked in them, what each stay has
 * run up, and the bill at departure.
 *
 * Kept from the old front desk: a board of rooms with their state, bookings
 * with the guest's name, phone and document, check-in and check-out, extras
 * charged to the room, advances. Changed: the bill is a sale, written once at
 * departure with every night and extra as its own line and the advances
 * counted as already paid, so the hotel's takings live in the same reports
 * as every other shop's, and an advance paid in cash is in the drawer the
 * day it was handed over.
 */

export type RoomState = "available" | "occupied" | "reserved" | "cleaning" | "maintenance" | "out_of_service";

export type Room = {
  id: string;
  number: string;
  kind: string | null;
  rate: number;
  capacity: number;
  state: RoomState;
  /** The stay in the room now, or arriving today. */
  stayId: string | null;
  guest: string | null;
  leavesOn: string | null;
  arrivesOn: string | null;
  floor: number | null;
  /** What the guest in the room still owes, for the board. */
  balance: number | null;
  /** Problems reported in the room and not yet put right. */
  openIssues: number;
};

export type Stay = {
  id: string;
  number: number;
  roomId: string;
  roomNumber: string;
  guest: string;
  phone: string | null;
  idDocument: string | null;
  nationality: string | null;
  adults: number;
  arrivesOn: string;
  leavesOn: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  rate: number;
  status: "reserved" | "in" | "out" | "cancelled";
  note: string | null;
};

function blank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function nightsBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((value) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  });
  return Math.round((b - a) / 86_400_000);
}

export function addRoom(
  database: Database.Database,
  deviceId: string,
  input: { number: string; kind?: string | null; rate: number; capacity?: number; floor?: number | null }
): string {
  const number = input.number.trim();
  if (!number) throw new Error("a room needs its number");
  if (!Number.isInteger(input.rate) || input.rate < 0) throw new Error("a rate is a whole number of minor units");
  const clash = database.prepare("select id from rooms where number = ? and archived_at is null").get(number);
  if (clash) throw new Error("room exists");
  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into rooms (id, device_id, created_at, counter, number, kind, rate, capacity, floor)
       values (@id, @device_id, @created_at, @counter, @number, @kind, @rate, @capacity, @floor)`
    )
    .run({ ...row, number, kind: blank(input.kind), rate: input.rate, capacity: input.capacity ?? 2, floor: floorOf(number, input.floor) });
  return row.id;
}

export function updateRoom(
  database: Database.Database,
  id: string,
  input: { kind?: string | null; rate?: number; capacity?: number; floor?: number | null }
): void {
  const current = database.prepare("select kind, rate, capacity, floor from rooms where id = ?").get(id) as
    | { kind: string | null; rate: number; capacity: number; floor: number | null }
    | undefined;
  if (!current) throw new Error("no such room");
  database
    .prepare("update rooms set kind = ?, rate = ?, capacity = ?, floor = ? where id = ?")
    .run(
      input.kind !== undefined ? blank(input.kind) : current.kind,
      input.rate ?? current.rate,
      input.capacity ?? current.capacity,
      input.floor !== undefined ? input.floor : current.floor,
      id
    );
}

/* A room's floor as typed, or read from its number the usual way: 101 is on the first. */
function floorOf(number: string, floor: number | null | undefined): number | null {
  if (typeof floor === "number" && Number.isInteger(floor)) return floor;
  return /^\d{3,}$/.test(number) ? Number(number.slice(0, -2)) : null;
}

/* Housekeeping: a room being cleaned, under repair, or out of use. */
export function setRoomStatus(database: Database.Database, id: string, status: "available" | "cleaning" | "maintenance" | "out_of_service"): void {
  if (!["available", "cleaning", "maintenance", "out_of_service"].includes(status)) throw new Error("no such status");
  database.prepare("update rooms set status = ? where id = ?").run(status, id);
}

export type Issue = { id: string; roomId: string; issue: string; assignedTo: string | null; status: "open" | "resolved"; createdAt: string; resolvedAt: string | null; resolution: string | null };

/* Something wrong in a room: reported, and the room goes to maintenance until it is put right. */
export function reportIssue(database: Database.Database, deviceId: string, input: { roomId: string; issue: string; assignedTo?: string | null }): string {
  const issue = input.issue.trim();
  if (!issue) throw new Error("an issue says what is wrong");
  const write = database.transaction(() => {
    const row = stamp(database, deviceId);
    database
      .prepare(
        `insert into maintenance_issues (id, device_id, created_at, counter, room_id, issue, assigned_to)
         values (@id, @device_id, @created_at, @counter, @room_id, @issue, @assigned_to)`
      )
      .run({ ...row, room_id: input.roomId, issue: issue.slice(0, 200), assigned_to: blank(input.assignedTo)?.slice(0, 80) ?? null });
    /* A room with a guest in it stays theirs; an empty one is taken off the board until it is fixed. */
    const inside = database.prepare("select 1 from stays where room_id = ? and status = 'in'").get(input.roomId);
    if (!inside) database.prepare("update rooms set status = 'maintenance' where id = ?").run(input.roomId);
    audit(database, deviceId, { staffId: null, subject: "room", subjectId: input.roomId, action: "issue_reported", detail: { issue } });
    return row.id;
  });
  return write();
}

/* Put right. When nothing else is open in the room, it goes to cleaning, ready to be checked. */
export function resolveIssue(database: Database.Database, deviceId: string, id: string, resolution: string | null, now = clock()): void {
  const write = database.transaction(() => {
    const row = database.prepare("select room_id from maintenance_issues where id = ? and status = 'open'").get(id) as { room_id: string } | undefined;
    if (!row) throw new Error("no such open issue");
    database
      .prepare("update maintenance_issues set status = 'resolved', resolved_at = ?, resolution = ? where id = ?")
      .run(now.toISOString(), blank(resolution)?.slice(0, 200) ?? null, id);
    const left = (database.prepare("select count(*) as n from maintenance_issues where room_id = ? and status = 'open'").get(row.room_id) as { n: number }).n;
    if (left === 0) database.prepare("update rooms set status = 'cleaning' where id = ? and status = 'maintenance'").run(row.room_id);
    audit(database, deviceId, { staffId: null, subject: "room", subjectId: row.room_id, action: "issue_resolved", detail: { issueId: id } });
  });
  write();
}

export function issuesOf(database: Database.Database, roomId: string): Issue[] {
  return (
    database
      .prepare("select * from maintenance_issues where room_id = ? order by case status when 'open' then 0 else 1 end, created_at desc limit 30")
      .all(roomId) as { id: string; room_id: string; issue: string; assigned_to: string | null; status: Issue["status"]; created_at: string; resolved_at: string | null; resolution: string | null }[]
  ).map((row) => ({
    id: row.id,
    roomId: row.room_id,
    issue: row.issue,
    assignedTo: row.assigned_to,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  }));
}

export function listRooms(database: Database.Database, now = clock()): Room[] {
  const date = today(now);
  const rooms = database
    .prepare("select id, number, kind, rate, capacity, status, floor from rooms where archived_at is null order by length(number), number")
    .all() as { id: string; number: string; kind: string | null; rate: number; capacity: number; status: string; floor: number | null }[];
  return rooms.map((room) => {
    const inside = database
      .prepare("select id, guest, leaves_on, arrives_on from stays where room_id = ? and status = 'in' limit 1")
      .get(room.id) as { id: string; guest: string; leaves_on: string; arrives_on: string } | undefined;
    const arriving = inside
      ? undefined
      : (database
          .prepare("select id, guest, leaves_on, arrives_on from stays where room_id = ? and status = 'reserved' and arrives_on <= ? and leaves_on > ? order by arrives_on limit 1")
          .get(room.id, date, date) as { id: string; guest: string; leaves_on: string; arrives_on: string } | undefined);
    const stay = inside ?? arriving;
    const state: RoomState = inside
      ? "occupied"
      : room.status === "out_of_service"
        ? "out_of_service"
        : room.status === "maintenance"
          ? "maintenance"
          : room.status === "cleaning"
            ? "cleaning"
            : arriving
              ? "reserved"
              : "available";
    return {
      id: room.id,
      number: room.number,
      kind: room.kind,
      rate: room.rate,
      capacity: room.capacity,
      state,
      stayId: stay?.id ?? null,
      guest: stay?.guest ?? null,
      leavesOn: stay?.leaves_on ?? null,
      arrivesOn: stay?.arrives_on ?? null,
      floor: room.floor,
      balance: inside ? folioOf(database, inside.id, (number) => number, now).balance : null,
      openIssues: (database.prepare("select count(*) as n from maintenance_issues where room_id = ? and status = 'open'").get(room.id) as { n: number }).n,
    };
  });
}

type StayRow = {
  id: string;
  number: number;
  room_id: string;
  room_number: string;
  guest: string;
  phone: string | null;
  id_document: string | null;
  nationality: string | null;
  adults: number;
  arrives_on: string;
  leaves_on: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  rate: number;
  status: Stay["status"];
  note: string | null;
};

const STAY = `select s.*, r.number as room_number from stays s join rooms r on r.id = s.room_id`;

function toStay(row: StayRow): Stay {
  return {
    id: row.id,
    number: row.number,
    roomId: row.room_id,
    roomNumber: row.room_number,
    guest: row.guest,
    phone: row.phone,
    idDocument: row.id_document,
    nationality: row.nationality,
    adults: row.adults,
    arrivesOn: row.arrives_on,
    leavesOn: row.leaves_on,
    checkedInAt: row.checked_in_at,
    checkedOutAt: row.checked_out_at,
    rate: row.rate,
    status: row.status,
    note: row.note,
  };
}

export function listStays(database: Database.Database, which: "current" | "all" = "current"): Stay[] {
  const rows = database
    .prepare(`${STAY} ${which === "current" ? "where s.status in ('reserved', 'in')" : ""} order by s.arrives_on, s.number`)
    .all() as StayRow[];
  return rows.map(toStay);
}

export function getStay(database: Database.Database, id: string): Stay | null {
  const row = database.prepare(`${STAY} where s.id = ?`).get(id) as StayRow | undefined;
  return row ? toStay(row) : null;
}

/*
 * A booking. Refused when the room already has a stay over any of those
 * nights: two guests handed the same key is the one mistake a front desk
 * must never make.
 */
export function bookStay(
  database: Database.Database,
  deviceId: string,
  input: {
    roomId: string;
    guest: string;
    phone?: string | null;
    idDocument?: string | null;
    nationality?: string | null;
    adults?: number;
    arrivesOn: string;
    leavesOn: string;
    rate?: number;
    advance?: number;
    advancePayment?: "cash" | "mobile";
    note?: string | null;
    checkInNow?: boolean;
    staffId?: string | null;
  },
  now = clock()
): string {
  const guest = blank(input.guest);
  if (!guest) throw new Error("a stay needs the guest's name");
  if (!DATE.test(input.arrivesOn) || !DATE.test(input.leavesOn)) throw new Error("a date is YYYY-MM-DD");
  if (nightsBetween(input.arrivesOn, input.leavesOn) < 1) throw new Error("a stay is at least one night");
  const write = database.transaction(() => {
    const room = database.prepare("select rate from rooms where id = ? and archived_at is null").get(input.roomId) as { rate: number } | undefined;
    if (!room) throw new Error("no such room");
    const overlap = database
      .prepare(
        `select id from stays where room_id = ? and status in ('reserved', 'in')
           and arrives_on < ? and leaves_on > ? limit 1`
      )
      .get(input.roomId, input.leavesOn, input.arrivesOn);
    if (overlap) throw new Error("room taken");

    const row = stamp(database, deviceId);
    const number = (database.prepare("select coalesce(max(number), 0) + 1 as n from stays").get() as { n: number }).n;
    database
      .prepare(
        `insert into stays (id, device_id, created_at, counter, number, room_id, guest, phone, id_document, nationality, adults,
                            arrives_on, leaves_on, rate, status, checked_in_at, note, staff_id)
         values (@id, @device_id, @created_at, @counter, @number, @room_id, @guest, @phone, @id_document, @nationality, @adults,
                 @arrives_on, @leaves_on, @rate, @status, @checked_in_at, @note, @staff_id)`
      )
      .run({
        ...row,
        number,
        room_id: input.roomId,
        guest,
        phone: blank(input.phone),
        id_document: blank(input.idDocument),
        nationality: blank(input.nationality),
        adults: input.adults ?? 1,
        arrives_on: input.arrivesOn,
        leaves_on: input.leavesOn,
        rate: input.rate ?? room.rate,
        status: input.checkInNow ? "in" : "reserved",
        checked_in_at: input.checkInNow ? now.toISOString() : null,
        note: blank(input.note),
        staff_id: input.staffId ?? null,
      });
    if (input.advance && input.advance > 0) {
      addCashMovement(
        database,
        deviceId,
        { direction: "in", amount: input.advance, payment: input.advancePayment ?? "cash", reason: "advance", reference: row.id, note: guest, staffId: input.staffId ?? null },
        now
      );
    }
    return row.id;
  });
  return write();
}

export function checkIn(database: Database.Database, id: string, now = clock()): void {
  const result = database
    .prepare("update stays set status = 'in', checked_in_at = ? where id = ? and status = 'reserved'")
    .run(now.toISOString(), id);
  if (result.changes === 0) throw new Error("not a reservation");
}

export function addAdvance(
  database: Database.Database,
  deviceId: string,
  stayId: string,
  amount: number,
  payment: "cash" | "mobile",
  staffId: string | null = null
): void {
  const stay = getStay(database, stayId);
  if (!stay || stay.status === "out" || stay.status === "cancelled") throw new Error("stay closed");
  addCashMovement(database, deviceId, { direction: "in", amount, payment, reason: "advance", reference: stayId, note: stay.guest, staffId });
}

export function addCharge(
  database: Database.Database,
  deviceId: string,
  input: { stayId: string; label: string; quantity?: number; unitPrice: number },
  now = clock()
): string {
  const label = input.label.trim();
  if (!label) throw new Error("a charge says what it is for");
  if (!Number.isInteger(input.unitPrice) || input.unitPrice < 0) throw new Error("a price is a whole number of minor units");
  const stay = getStay(database, input.stayId);
  if (!stay || stay.status === "out" || stay.status === "cancelled") throw new Error("stay closed");
  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into stay_charges (id, device_id, created_at, counter, stay_id, label, quantity, unit_price, occurred_at)
       values (@id, @device_id, @created_at, @counter, @stay_id, @label, @quantity, @unit_price, @occurred_at)`
    )
    .run({ ...row, stay_id: input.stayId, label, quantity: input.quantity ?? 1, unit_price: input.unitPrice, occurred_at: now.toISOString() });
  return row.id;
}

export type Folio = {
  stay: Stay;
  nights: number;
  lines: { label: string; quantity: number; unitPrice: number; total: number; kind: "room" | "service" }[];
  total: number;
  received: number;
  balance: number;
};

/*
 * The bill as it stands. Nights are counted from arrival to the day of
 * departure, or to today when the guest leaves early or stays on, and never
 * fewer than one.
 */
export function folioOf(database: Database.Database, stayId: string, roomLabel: (room: string, nights: number) => string, now = clock()): Folio {
  const stay = getStay(database, stayId);
  if (!stay) throw new Error("no such stay");
  const end = stay.status === "out" && stay.checkedOutAt ? today(new Date(stay.checkedOutAt)) : stay.status === "in" ? today(now) : stay.leavesOn;
  const start = stay.checkedInAt ? today(new Date(stay.checkedInAt)) : stay.arrivesOn;
  const nights = Math.max(1, nightsBetween(start, end > start ? end : stay.leavesOn));
  const extras = database
    .prepare("select label, quantity, unit_price from stay_charges where stay_id = ? order by occurred_at, counter")
    .all(stayId) as { label: string; quantity: number; unit_price: number }[];
  const lines: Folio["lines"] = [
    { label: roomLabel(stay.roomNumber, nights), quantity: nights, unitPrice: stay.rate, total: nights * stay.rate, kind: "room" },
    ...extras.map((extra) => ({
      label: extra.label,
      quantity: extra.quantity,
      unitPrice: extra.unit_price,
      total: Math.round(extra.quantity * extra.unit_price),
      kind: "service" as const,
    })),
  ];
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  const received = receivedFor(database, stayId);
  return { stay, nights, lines, total, received, balance: total - received };
}

/* Departure: the bill becomes a sale, the room goes to cleaning. */
export function checkOut(
  database: Database.Database,
  deviceId: string,
  stayId: string,
  payment: Omit<NewSale, "lines" | "reference" | "prepaid">,
  roomLabel: (room: string, nights: number) => string,
  now = clock()
): RecordedSale {
  const write = database.transaction(() => {
    const folio = folioOf(database, stayId, roomLabel, now);
    if (folio.stay.status !== "in") throw new Error("not in the hotel");
    const sale = recordSale(
      database,
      deviceId,
      {
        ...payment,
        reference: stayId,
        prepaid: Math.min(folio.received, folio.total),
        lines: folio.lines.map((line) => ({ label: line.label, kind: line.kind, quantity: line.quantity, unitPrice: line.unitPrice, reference: stayId })),
      },
      now
    );
    database.prepare("update stays set status = 'out', checked_out_at = ?, sale_id = ? where id = ?").run(now.toISOString(), sale.id, stayId);
    database.prepare("update rooms set status = 'cleaning' where id = ?").run(folio.stay.roomId);
    return sale;
  });
  return write();
}

export function cancelStay(
  database: Database.Database,
  deviceId: string,
  stayId: string,
  refund: boolean,
  staffId: string | null = null
): void {
  const write = database.transaction(() => {
    const stay = getStay(database, stayId);
    if (!stay || stay.status !== "reserved") throw new Error("only a reservation is cancelled");
    const received = receivedFor(database, stayId);
    if (refund && received > 0) {
      addCashMovement(database, deviceId, { direction: "out", amount: received, reason: "deposit_refund", reference: stayId, note: stay.guest, staffId });
    }
    database.prepare("update stays set status = 'cancelled' where id = ?").run(stayId);
    audit(database, deviceId, { staffId, subject: "stay", subjectId: stayId, action: "cancelled", detail: { refund } });
  });
  write();
}

/* Nights sold over nights available, for the reports. */
export function occupancy(database: Database.Database, from: string, to: string): { roomNights: number; sold: number; percent: number } {
  const rooms = (database.prepare("select count(*) as n from rooms where archived_at is null").get() as { n: number }).n;
  const days = Math.max(1, nightsBetween(from, to));
  const stays = database
    .prepare(
      `select coalesce(date(checked_in_at, 'localtime'), arrives_on) as start,
              coalesce(date(checked_out_at, 'localtime'), leaves_on) as finish
         from stays where status in ('in', 'out') and arrives_on < ? and leaves_on > ?`
    )
    .all(to, from) as { start: string; finish: string }[];
  let sold = 0;
  for (const stay of stays) {
    const start = stay.start > from ? stay.start : from;
    const finish = stay.finish < to ? stay.finish : to;
    sold += Math.max(0, nightsBetween(start, finish));
  }
  const roomNights = rooms * days;
  return { roomNights, sold, percent: roomNights > 0 ? Math.round((sold / roomNights) * 100) : 0 };
}

/*
 * A stay changed at the desk: a new departure date, or another room. Both
 * are refused when another guest already has the room for any of those
 * nights, the same way a booking is.
 */
export function editStay(
  database: Database.Database,
  deviceId: string,
  stayId: string,
  input: { leavesOn?: string; roomId?: string; adults?: number },
  staffId: string | null = null
): void {
  const write = database.transaction(() => {
    const stay = getStay(database, stayId);
    if (!stay || stay.status === "out" || stay.status === "cancelled") throw new Error("stay closed");
    const leavesOn = input.leavesOn ?? stay.leavesOn;
    const roomId = input.roomId ?? stay.roomId;
    if (!DATE.test(leavesOn)) throw new Error("a date is YYYY-MM-DD");
    if (nightsBetween(stay.arrivesOn, leavesOn) < 1) throw new Error("a stay is at least one night");
    const room = database.prepare("select rate from rooms where id = ? and archived_at is null").get(roomId) as { rate: number } | undefined;
    if (!room) throw new Error("no such room");
    const overlap = database
      .prepare(
        `select id from stays where room_id = ? and id <> ? and status in ('reserved', 'in')
           and arrives_on < ? and leaves_on > ? limit 1`
      )
      .get(roomId, stayId, leavesOn, stay.status === "in" ? today() : stay.arrivesOn);
    if (overlap) throw new Error("room taken");
    const adults = input.adults !== undefined && Number.isInteger(input.adults) && input.adults > 0 ? input.adults : stay.adults;
    database.prepare("update stays set leaves_on = ?, room_id = ?, adults = ? where id = ?").run(leavesOn, roomId, adults, stayId);
    /* The room left behind needs cleaning before the next guest. */
    if (roomId !== stay.roomId && stay.status === "in") database.prepare("update rooms set status = 'cleaning' where id = ?").run(stay.roomId);
    audit(database, deviceId, { staffId, subject: "stay", subjectId: stayId, action: "edited", detail: { leavesOn, roomId } });
  });
  write();
}

export type StayLine = Stay & { total: number; received: number; balance: number; paid: "unpaid" | "partial" | "paid" };

/* Every booking with what it comes to and what was received, for the list and its payment filter. */
export function stayLines(database: Database.Database, now = clock()): StayLine[] {
  return listStays(database, "all")
    .reverse()
    .map((stay) => {
      const folio = folioOf(database, stay.id, (number) => number, now);
      const paidAtCheckout = stay.status === "out";
      const received = paidAtCheckout ? folio.total : folio.received;
      const balance = folio.total - received;
      return {
        ...stay,
        total: folio.total,
        received,
        balance,
        paid: balance <= 0 ? ("paid" as const) : received > 0 ? ("partial" as const) : ("unpaid" as const),
      };
    });
}

