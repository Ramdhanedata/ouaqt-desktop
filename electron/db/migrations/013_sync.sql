-- A shop's devices seeing each other's work.
--
-- Each device keeps every record, as before. What it has changed since it last
-- spoke to the others waits in sync_log, and sync_versions says how recent each
-- row is, so the same change arriving twice, or an older one arriving late,
-- changes nothing. See db/sync.ts.

create table if not exists sync_control (
  id       integer primary key check (id = 1),
  -- 1 while another device's changes are being written, so they are not sent back.
  applying integer not null default 0
);
insert or ignore into sync_control (id, applying) values (1, 0);

-- What this device has yet to send: which rows, not their contents, so a row
-- changed five times is read once, as it stands.
create table if not exists sync_log (
  seq    integer primary key autoincrement,
  tbl    text not null,
  row_id text not null
);

-- How recent each row is. n counts the row's changes, so an edit made after
-- seeing another device's always wins, whatever the two clocks say. at and
-- device only settle two edits made apart, the same way on every device.
create table if not exists sync_versions (
  tbl     text not null,
  row_id  text not null,
  n       integer not null,
  at      text not null,
  device  text not null,
  deleted integer not null default 0,
  primary key (tbl, row_id)
) without rowid;

-- The same thing made separately on two devices (a product imported on both,
-- the same member of staff): their row here, ours kept, one thing to the owner.
create table if not exists sync_alias (
  tbl       text not null,
  remote_id text not null,
  local_id  text not null,
  primary key (tbl, remote_id)
) without rowid;

-- A row this version cannot take yet, from a device that was updated first.
-- Kept and tried again after this one is updated, never thrown away.
create table if not exists sync_pending (
  id      integer primary key autoincrement,
  payload text not null
);

-- Each device has its own drawer, so what was taken says on which device.
drop view if exists sale_takings;
create view sale_takings as
  select s.id as sale_id, s.occurred_at, s.payment as method, s.mobile_app,
         s.total - s.covered as amount, s.total - s.prepaid - s.covered as due, s.device_id
    from sales s
   where not exists (select 1 from sale_payments p where p.sale_id = s.id)
  union all
  select p.sale_id, s.occurred_at, p.method, p.mobile_app, p.amount, p.amount, s.device_id
    from sale_payments p join sales s on s.id = p.sale_id
  union all
  select s.id, s.occurred_at, 'insurance', null, s.covered, s.covered, s.device_id
    from sales s
   where s.covered <> 0;
