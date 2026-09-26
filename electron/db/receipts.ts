import type Database from "better-sqlite3";
import { receivedFor } from "./cashbook";

/*
 * What a sale settled, for its receipt.
 *
 * A restaurant's bill, a hotel's checkout, a bus ticket, a parcel and a
 * bakery's order taken ahead each keep the id of the sale that paid them.
 * From that id the receipt learns what kind of paper it is and what to put
 * on it: the table and the kind of service, the room and the dates, the
 * seat and the departure, the sender and the receiver. A sale that settled
 * none of them is a sale at the counter, and prints as one.
 */

export type ReceiptContext =
  | {
      kind: "order";
      number: number;
      service: "dine_in" | "takeaway" | "delivery";
      table: number | null;
      guests: number | null;
      customer: string | null;
      /* What the kitchen was told for each dish, by product, so the bill says it too. */
      notes: Record<string, string[]>;
    }
  | {
      kind: "stay";
      number: number;
      guest: string;
      room: string;
      roomKind: string | null;
      arrivesOn: string;
      leavesOn: string;
      checkedInAt: string | null;
      checkedOutAt: string | null;
      advance: number;
    }
  | {
      kind: "ticket";
      number: number;
      origin: string;
      destination: string;
      departsAt: string;
      seat: number | null;
      passenger: string;
      phone: string | null;
      plate: string | null;
    }
  | {
      kind: "parcel";
      code: string;
      origin: string | null;
      destination: string | null;
      sender: string;
      senderPhone: string | null;
      receiver: string;
      receiverPhone: string | null;
      description: string | null;
      weight: number | null;
      paidBy: "sender" | "receiver";
    }
  | {
      kind: "preorder";
      number: number;
      customer: string;
      dueOn: string;
      deposit: number;
    };

export function receiptContext(database: Database.Database, saleId: string): ReceiptContext | null {
  /* A void prints what it cancels: its context is the cancelled sale's. */
  const reverses = database.prepare("select reverses_id from sales where id = ?").get(saleId) as { reverses_id: string | null } | undefined;
  const id = reverses?.reverses_id ?? saleId;

  const order = database
    .prepare("select id, number, service, table_no, guests, customer from orders where sale_id = ?")
    .get(id) as { id: string; number: number; service: string; table_no: number | null; guests: number | null; customer: string | null } | undefined;
  if (order) {
    const notes: Record<string, string[]> = {};
    const noted = database
      .prepare("select product_id, note from order_lines where order_id = ? and cancelled_at is null and note is not null and trim(note) <> '' order by counter")
      .all(order.id) as { product_id: string; note: string }[];
    for (const line of noted) (notes[line.product_id] ??= []).push(line.note.trim());
    return {
      kind: "order",
      number: order.number,
      service: order.service === "takeaway" || order.service === "delivery" ? order.service : "dine_in",
      table: order.table_no,
      guests: order.guests,
      customer: order.customer,
      notes,
    };
  }

  const stay = database
    .prepare(
      `select s.id, s.number, s.guest, r.number as room, r.kind as room_kind, s.arrives_on, s.leaves_on, s.checked_in_at, s.checked_out_at
         from stays s join rooms r on r.id = s.room_id
        where s.sale_id = ?`
    )
    .get(id) as
    | { id: string; number: number; guest: string; room: string; room_kind: string | null; arrives_on: string; leaves_on: string; checked_in_at: string | null; checked_out_at: string | null }
    | undefined;
  if (stay) {
    return {
      kind: "stay",
      number: stay.number,
      guest: stay.guest,
      room: stay.room,
      roomKind: stay.room_kind,
      arrivesOn: stay.arrives_on,
      leavesOn: stay.leaves_on,
      checkedInAt: stay.checked_in_at,
      checkedOutAt: stay.checked_out_at,
      advance: Math.max(0, receivedFor(database, stay.id)),
    };
  }

  const ticket = database
    .prepare(
      `select t.number, t.seat, t.passenger, t.phone, r.origin, r.destination, tr.departs_at, v.plate
         from tickets t
         join trips tr on tr.id = t.trip_id
         join routes r on r.id = tr.route_id
         left join vehicles v on v.id = tr.vehicle_id
        where t.sale_id = ?`
    )
    .get(id) as
    | { number: number; seat: number | null; passenger: string; phone: string | null; origin: string; destination: string; departs_at: string; plate: string | null }
    | undefined;
  if (ticket) {
    return {
      kind: "ticket",
      number: ticket.number,
      origin: ticket.origin,
      destination: ticket.destination,
      departsAt: ticket.departs_at,
      seat: ticket.seat,
      passenger: ticket.passenger,
      phone: ticket.phone,
      plate: ticket.plate,
    };
  }

  const parcel = database
    .prepare(
      `select p.code, p.sender, p.sender_phone, p.receiver, p.receiver_phone, p.description, p.weight, p.paid_by,
              coalesce(r.origin, tr_route.origin) as origin, coalesce(r.destination, tr_route.destination) as destination
         from parcels p
         left join routes r on r.id = p.route_id
         left join trips tr on tr.id = p.trip_id
         left join routes tr_route on tr_route.id = tr.route_id
        where p.sale_id = ?`
    )
    .get(id) as
    | {
        code: string;
        sender: string;
        sender_phone: string | null;
        receiver: string;
        receiver_phone: string | null;
        description: string | null;
        weight: number | null;
        paid_by: string;
        origin: string | null;
        destination: string | null;
      }
    | undefined;
  if (parcel) {
    return {
      kind: "parcel",
      code: parcel.code,
      origin: parcel.origin,
      destination: parcel.destination,
      sender: parcel.sender,
      senderPhone: parcel.sender_phone,
      receiver: parcel.receiver,
      receiverPhone: parcel.receiver_phone,
      description: parcel.description,
      weight: parcel.weight,
      paidBy: parcel.paid_by === "receiver" ? "receiver" : "sender",
    };
  }

  const preorder = database
    .prepare("select id, number, customer, due_on from preorders where sale_id = ?")
    .get(id) as { id: string; number: number; customer: string; due_on: string } | undefined;
  if (preorder) {
    return {
      kind: "preorder",
      number: preorder.number,
      customer: preorder.customer,
      dueOn: preorder.due_on,
      deposit: Math.max(0, receivedFor(database, preorder.id)),
    };
  }

  return null;
}
