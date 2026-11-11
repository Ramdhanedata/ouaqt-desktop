-- Sales brought in from a spreadsheet: the days before OUAQT, or a book kept
-- by hand beside it.
--
-- They are ordinary sales, so every total, chart and comparison counts them
-- with the ones rung up here, day by day. Two things set them apart: the
-- import they came in with, so a wrong file can be taken back out whole, and
-- a fingerprint of the row, so the same file read twice adds nothing the
-- second time. The till never counts them: their money was never in today's
-- drawer.

create table if not exists sale_imports (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  file_name   text,
  sales       integer not null,
  total       integer not null,
  first_day   text,
  last_day    text,
  undone_at   text
);

alter table sales add column import_id text;
alter table sales add column import_key text;
create index if not exists sales_import_key_idx on sales (import_key);
create index if not exists sales_import_idx on sales (import_id);

-- The drawer reads this view and leaves imported sales out; the reports read
-- it and keep them.
drop view if exists sale_takings;
create view sale_takings as
  select s.id as sale_id, s.occurred_at, s.payment as method, s.mobile_app,
         s.total - s.covered as amount, s.total - s.prepaid - s.covered as due, s.device_id, s.import_id
    from sales s
   where not exists (select 1 from sale_payments p where p.sale_id = s.id)
  union all
  select p.sale_id, s.occurred_at, p.method, p.mobile_app, p.amount, p.amount, s.device_id, s.import_id
    from sale_payments p join sales s on s.id = p.sale_id
  union all
  select s.id, s.occurred_at, 'insurance', null, s.covered, s.covered, s.device_id, s.import_id
    from sales s
   where s.covered <> 0;
