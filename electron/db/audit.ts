import type Database from "better-sqlite3";
import { stamp } from "./rows";

/*
 * Who did what, on this computer.
 *
 * Kept from the old pharmacy till, where every action carried a person, an
 * amount and a reason, because that is how an owner finds out what happened
 * at the counter while he was out. Written inside the same transaction as
 * the thing it describes, so the log cannot say something happened that did
 * not, or miss something that did.
 */

export type AuditEntry = {
  staffId: string | null;
  subject: string;
  subjectId?: string | null;
  action: string;
  detail?: Record<string, unknown>;
};

export function audit(database: Database.Database, deviceId: string, entry: AuditEntry): void {
  const row = stamp(database, deviceId);
  database
    .prepare(
      `insert into audit_local (id, device_id, created_at, counter, staff_id, subject, subject_id, action, detail)
       values (@id, @device_id, @created_at, @counter, @staff_id, @subject, @subject_id, @action, @detail)`
    )
    .run({
      ...row,
      staff_id: entry.staffId,
      subject: entry.subject,
      subject_id: entry.subjectId ?? null,
      action: entry.action,
      detail: entry.detail ? JSON.stringify(entry.detail) : null,
    });
}

export type AuditRow = {
  id: string;
  at: string;
  subject: string;
  subjectId: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  /** What the line is about, by name, where the log can find it. */
  subjectName?: string | null;
};

export function recentAudit(database: Database.Database, limit = 200): AuditRow[] {
  const rows = database
    .prepare(
      `select id, created_at, subject, subject_id, action, detail
         from audit_local order by created_at desc, counter desc limit ?`
    )
    .all(limit) as {
    id: string;
    created_at: string;
    subject: string;
    subject_id: string | null;
    action: string;
    detail: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    at: row.created_at,
    subject: row.subject,
    subjectId: row.subject_id,
    action: row.action,
    detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null,
  }));
}

/* The log over a period, newest first, for the Journal in Rapports. */
export function auditBetween(database: Database.Database, from: string, to: string, limit = 1000): AuditRow[] {
  const rows = database
    .prepare(
      /* The name of what a line is about, read now, so "Réception" says of what. */
      `select a.id, a.created_at, a.subject, a.subject_id, a.action, a.detail,
              case a.subject
                when 'product' then (select name from products where id = a.subject_id)
                when 'customer' then (select name from customers where id = a.subject_id)
                when 'room' then (select number from rooms where id = a.subject_id)
              end as subject_name
         from audit_local a where a.created_at >= ? and a.created_at < ?
        order by a.created_at desc, a.counter desc limit ?`
    )
    .all(from, to, limit) as { id: string; created_at: string; subject: string; subject_id: string | null; action: string; detail: string | null; subject_name: string | null }[];
  return rows.map((row) => ({
    id: row.id,
    at: row.created_at,
    subject: row.subject,
    subjectId: row.subject_id,
    action: row.action,
    detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null,
    subjectName: row.subject_name,
  }));
}
