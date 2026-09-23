-- What the screens after the till need: batches with their expiry, the
-- second name a pharmacist searches by, how a sale was paid, and customers
-- that can be archived.
--
-- Every change here adds; nothing already written is rewritten. A shop that
-- ran 0.1 opens on 0.2 with every sale, movement and debt where it was.

-- The generic name (DCI) beside the commercial one, and a category, both
-- searchable. The old pharmacy till searched both names, and a pharmacist
-- asked for "paracétamol" expects every brand of it.
alter table products add column generic_name text;
alter table products add column category text;

-- One row per batch received. A pharmacy receives the same medicine several
-- times with several expiry dates, so the expiry belongs to the batch, not
-- to the product. What is left of a batch is the sum of its movements, like
-- everything else.
create table if not exists batches (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  product_id  text not null references products (id),
  lot         text,
  -- A date, YYYY-MM-DD, or null when the box carries none.
  expires_on  text,
  cost_price  integer,
  reception_id text references receptions (id)
);
create index if not exists batches_product_idx on batches (product_id, expires_on);

alter table stock_movements add column batch_id text references batches (id);
create index if not exists movements_batch_idx on stock_movements (batch_id);

-- How a sale was paid, beyond the kind: the discount given, the mobile app's
-- name, and what the customer handed over, for the change on the receipt.
alter table sales add column discount integer not null default 0;
alter table sales add column mobile_app text;
alter table sales add column received integer;

-- A payment against a customer's debt says how it was paid, so cash paid on
-- an account counts in the till at closing.
alter table credit_entries add column payment text;
alter table credit_entries add column note text;

alter table customers add column credit_limit integer;
alter table customers add column note text;
alter table customers add column archived_at text;

-- The till's opening float and its closing count already live in
-- cash_sessions; the index makes "the open session" a lookup.
create index if not exists cash_open_idx on cash_sessions (closed_at);

-- The search index, rebuilt with the generic name in it.
drop trigger if exists products_search_insert;
drop trigger if exists products_search_delete;
drop trigger if exists products_search_update;
drop table if exists products_search;

create virtual table products_search using fts5(
  name,
  name_arabic,
  generic_name,
  barcode,
  content = 'products',
  content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2"
);

create trigger products_search_insert after insert on products begin
  insert into products_search (rowid, name, name_arabic, generic_name, barcode)
  values (new.rowid, new.name, new.name_arabic, new.generic_name, new.barcode);
end;

create trigger products_search_delete after delete on products begin
  insert into products_search (products_search, rowid, name, name_arabic, generic_name, barcode)
  values ('delete', old.rowid, old.name, old.name_arabic, old.generic_name, old.barcode);
end;

create trigger products_search_update after update on products begin
  insert into products_search (products_search, rowid, name, name_arabic, generic_name, barcode)
  values ('delete', old.rowid, old.name, old.name_arabic, old.generic_name, old.barcode);
  insert into products_search (rowid, name, name_arabic, generic_name, barcode)
  values (new.rowid, new.name, new.name_arabic, new.generic_name, new.barcode);
end;

insert into products_search (products_search) values ('rebuild');
