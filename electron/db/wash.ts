import type Database from "better-sqlite3";
import { audit } from "./audit";
import { addCashMovement, receivedFor } from "./cashbook";
import { clock } from "./clock";
import { stamp } from "./rows";
import { recordSale, type NewSale, type RecordedSale } from "./sales";

/*
 * A wash's day: the jobs on the board, from waiting to paid.
 *
 * A job holds what was asked for, and no money until it is paid: the sale is
 * written then, from its lines, less any advance. So the till, the reports and
 * the receipts see a wash as they see any other sale, and a job that never
 * comes to be paid changes no figure at all.
 */

export type WashKind = "car" | "upholstery";
export type WashStatus = "waiting" | "washing" | "ready" | "paid" | "cancelled";

export type WashLine = { productId: string; name: string; nameArabic: string | null; quantity: number; unitPrice: number };

export type WashJob = {
  id: string;
  number: number;
  kind: WashKind;
  status: WashStatus;
  plate: string | null;
  vehicle: string | null;
  customer: string | null;
  phone: string | null;
  dueOn: string | null;
  washer: string | null;
  note: string | null;
  receivedAt: string;
  startedAt: string | null;
  readyAt: string | null;
  closedAt: string | null;
  saleId: string | null;
  total: number;
  /** What came in before the end: the advance. */
  received: number;
  lines: WashLine[];
};

export type NewWashJob = {
  kind: WashKind;
  plate?: string | null;
  vehicle?: string | null;
  customer?: string | null;
  phone?: string | null;
  dueOn?: string | null;
  washer?: string | null;
  note?: string | null;
  lines: { productId: string; quantity: number; unitPrice: number }[];
  deposit?: number;
  depositPayment?: "cash" | "mobile";
};

type JobRow = {
  id: string;
  created_at: string;
  number: number;
  kind: WashKind;
  status: WashStatus;
  plate: string | null;
  vehicle: string | null;
  customer: string | null;
  phone: string | null;
  due_on: string | null;
  washer: string | null;
  note: string | null;
  started_at: string | null;
  ready_at: string | null;
  closed_at: string | null;
  sale_id: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function blank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

/* A plate is one thing however it was typed: "12 34 aa" and "1234AA" are the same car. */
function cleanPlate(value: string | null | undefined): string | null {
  const plate = blank(value);
  return plate ? plate.toUpperCase().replace(/\s+/g, " ") : null;
}

function jobFrom(database: Database.Database, row: JobRow): WashJob {
  const lines = (
    database
      .prepare(
        `select l.product_id, p.name, p.name_arabic, l.quantity, l.unit_price
           from wash_job_lines l join products p on p.id = l.product_id
          where l.job_id = ? order by l.counter`
      )
      .all(row.id) as { product_id: string; name: string; name_arabic: string | null; quantity: number; unit_price: number }[]
  ).map((line) => ({
    productId: line.product_id,
    name: line.name,
    nameArabic: line.name_arabic,
    quantity: line.quantity,
    unitPrice: line.unit_price,
  }));
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    status: row.status,
    plate: row.plate,
    vehicle: row.vehicle,
    customer: row.customer,
    phone: row.phone,
    dueOn: row.due_on,
    washer: row.washer,
    note: row.note,
    receivedAt: row.created_at,
    startedAt: row.started_at,
    readyAt: row.ready_at,
    closedAt: row.closed_at,
    saleId: row.sale_id,
    total: lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice), 0),
    received: receivedFor(database, row.id),
    lines,
  };
}

/* A job may be written before its services are chosen: they are needed only to be paid. */
function checkLines(lines: NewWashJob["lines"]): void {
  for (const line of lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new Error("a quantity is more than nothing");
    if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) throw new Error("a price is a whole number of the smallest unit");
  }
}

function writeLines(database: Database.Database, deviceId: string, jobId: string, lines: NewWashJob["lines"]): void {
  for (const line of lines) {
    database
      .prepare(
        `insert into wash_job_lines (id, device_id, created_at, counter, job_id, product_id, quantity, unit_price)
         values (@id, @device_id, @created_at, @counter, @job_id, @product_id, @quantity, @unit_price)`
      )
      .run({ ...stamp(database, deviceId), job_id: jobId, product_id: line.productId, quantity: line.quantity, unit_price: line.unitPrice });
  }
}

/*
 * A car is usually known by its plate, a piece left for days by whoever comes
 * back for it; but every detail may be left empty, and the job keeps its number.
 */
export function createWashJob(database: Database.Database, deviceId: string, input: NewWashJob, now = clock()): string {
  const plate = cleanPlate(input.plate);
  const customer = blank(input.customer);
  const dueOn = blank(input.dueOn);
  if (input.kind !== "car" && input.kind !== "upholstery") throw new Error("a wash is a car or upholstery");
  if (dueOn && !DATE.test(dueOn)) throw new Error("a date is YYYY-MM-DD");
  checkLines(input.lines);
  const total = input.lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice), 0);
  const deposit = input.deposit ?? 0;
  if (!Number.isInteger(deposit) || deposit < 0 || deposit > total) throw new Error("an advance is between nothing and the total");

  const write = database.transaction(() => {
    const row = stamp(database, deviceId);
    const number = (database.prepare("select coalesce(max(number), 0) + 1 as n from wash_jobs").get() as { n: number }).n;
    database
      .prepare(
        `insert into wash_jobs (id, device_id, created_at, counter, number, kind, plate, vehicle, customer, phone, due_on, washer, note)
         values (@id, @device_id, @created_at, @counter, @number, @kind, @plate, @vehicle, @customer, @phone, @due_on, @washer, @note)`
      )
      .run({
        ...row,
        number,
        kind: input.kind,
        plate,
        vehicle: blank(input.vehicle),
        customer,
        phone: blank(input.phone),
        due_on: dueOn,
        washer: blank(input.washer),
        note: blank(input.note),
      });
    writeLines(database, deviceId, row.id, input.lines);
    if (deposit > 0) {
      addCashMovement(
        database,
        deviceId,
        { direction: "in", amount: deposit, payment: input.depositPayment ?? "cash", reason: "deposit", reference: row.id, note: customer },
        now
      );
    }
    return row.id;
  });
  return write();
}

/* The board: everything not yet paid or cancelled, oldest first. */
export function listWashJobs(database: Database.Database): WashJob[] {
  const rows = database
    .prepare("select * from wash_jobs where status in ('waiting', 'washing', 'ready') order by number")
    .all() as JobRow[];
  return rows.map((row) => jobFrom(database, row));
}

export function washJob(database: Database.Database, id: string): WashJob | null {
  const row = database.prepare("select * from wash_jobs where id = ?").get(id) as JobRow | undefined;
  return row ? jobFrom(database, row) : null;
}

function openJob(database: Database.Database, id: string): WashJob {
  const job = washJob(database, id);
  if (!job) throw new Error("no such wash");
  if (job.status === "paid" || job.status === "cancelled") throw new Error("wash closed");
  return job;
}

/* Waiting, washing, ready, in any direction: a car sent back for a missed door is ordinary. */
export function setWashStatus(database: Database.Database, id: string, status: "waiting" | "washing" | "ready", now = clock()): void {
  if (status !== "waiting" && status !== "washing" && status !== "ready") throw new Error("not a status of an open wash");
  openJob(database, id);
  const at = now.toISOString();
  database
    .prepare(
      `update wash_jobs set status = @status,
         started_at = case when @status = 'washing' then coalesce(started_at, @at) else started_at end,
         ready_at = case when @status = 'ready' then @at when @status = 'waiting' then null else ready_at end
       where id = @id`
    )
    .run({ id, status, at });
}

/* What can change while a job is open: who does it, when it comes back, and what it holds. */
export function changeWashJob(
  database: Database.Database,
  deviceId: string,
  id: string,
  input: { washer?: string | null; note?: string | null; dueOn?: string | null; lines?: NewWashJob["lines"] }
): void {
  const write = database.transaction(() => {
    const job = openJob(database, id);
    const dueOn = input.dueOn === undefined ? job.dueOn : blank(input.dueOn);
    if (dueOn && !DATE.test(dueOn)) throw new Error("a date is YYYY-MM-DD");
    database
      .prepare("update wash_jobs set washer = @washer, note = @note, due_on = @due_on where id = @id")
      .run({
        id,
        washer: input.washer === undefined ? job.washer : blank(input.washer),
        note: input.note === undefined ? job.note : blank(input.note),
        due_on: dueOn,
      });
    if (input.lines) {
      checkLines(input.lines);
      const total = input.lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice), 0);
      if (job.received > total) throw new Error("the advance is more than the new total");
      database.prepare("delete from wash_job_lines where job_id = ?").run(id);
      writeLines(database, deviceId, id, input.lines);
    }
  });
  write();
}

/* Paid: the sale for the whole job, less what the advance already paid. */
export function payWashJob(
  database: Database.Database,
  deviceId: string,
  id: string,
  payment: Omit<NewSale, "lines" | "reference" | "prepaid">,
  now = clock()
): RecordedSale {
  const write = database.transaction(() => {
    const job = openJob(database, id);
    const sale = recordSale(
      database,
      deviceId,
      {
        ...payment,
        reference: id,
        prepaid: Math.min(job.received, job.total),
        lines: job.lines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice })),
      },
      now
    );
    database
      .prepare("update wash_jobs set status = 'paid', sale_id = @sale, closed_at = @at, ready_at = coalesce(ready_at, @at) where id = @id")
      .run({ id, sale: sale.id, at: now.toISOString() });
    return sale;
  });
  return write();
}

/* Cancelled, with the advance handed back or kept, as the owner decides. */
export function cancelWashJob(database: Database.Database, deviceId: string, id: string, refund: boolean, now = clock()): void {
  const write = database.transaction(() => {
    const job = openJob(database, id);
    if (refund && job.received > 0) {
      addCashMovement(database, deviceId, { direction: "out", amount: job.received, reason: "deposit_refund", reference: id }, now);
    }
    database.prepare("update wash_jobs set status = 'cancelled', closed_at = ? where id = ?").run(now.toISOString(), id);
    audit(database, deviceId, { staffId: null, subject: "wash", subjectId: id, action: "cancelled", detail: { refund } });
  });
  write();
}

/* Names already used, so a washer is picked rather than typed a little differently each time. */
export function washerNames(database: Database.Database): string[] {
  return (
    database
      .prepare("select washer from wash_jobs where washer is not null group by washer order by max(counter) desc limit 12")
      .all() as { washer: string }[]
  ).map((row) => row.washer);
}

export type WashReport = {
  jobs: number;
  amount: number;
  cars: number;
  upholstery: number;
  byWasher: { washer: string | null; jobs: number; amount: number }[];
};

/* What was paid in a period, by washer and by kind. A voided sale is a wash that brought in nothing. */
export function washReport(database: Database.Database, from: string, to: string): WashReport {
  const rows = database
    .prepare(
      `select j.kind, j.washer, s.total
         from wash_jobs j join sales s on s.id = j.sale_id
        where j.status = 'paid' and j.closed_at >= ? and j.closed_at <= ? and s.status != 'voided'`
    )
    .all(from, to) as { kind: WashKind; washer: string | null; total: number }[];
  const washers = new Map<string | null, { jobs: number; amount: number }>();
  for (const row of rows) {
    const one = washers.get(row.washer) ?? { jobs: 0, amount: 0 };
    washers.set(row.washer, { jobs: one.jobs + 1, amount: one.amount + row.total });
  }
  return {
    jobs: rows.length,
    amount: rows.reduce((sum, row) => sum + row.total, 0),
    cars: rows.filter((row) => row.kind === "car").length,
    upholstery: rows.filter((row) => row.kind === "upholstery").length,
    byWasher: [...washers.entries()]
      .map(([washer, one]) => ({ washer, ...one }))
      .sort((a, b) => b.amount - a.amount),
  };
}
