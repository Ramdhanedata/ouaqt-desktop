-- The owner's own shape for his lists: the app's columns renamed, moved or
-- hidden, and columns of his own. Kept here, with his data and never in the
-- application, so an update to the software never wipes what he built, and
-- a backup carries it.
--
-- A system column is one the app computes with (a name, a price, a stock):
-- it can be renamed, moved and hidden, never deleted, because a sale needs a
-- price. His own columns carry a type chosen when they are made, so they
-- sort, filter, total and print as what they are.

create table if not exists list_columns (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  list        text not null,
  key         text not null,
  system      integer not null,
  label       text,
  type        text,
  choices     text,
  position    integer not null,
  hidden      integer not null default 0,
  unique (list, key)
);

create table if not exists column_values (
  list       text not null,
  row_id     text not null,
  column_id  text not null,
  value      text not null,
  primary key (list, row_id, column_id)
);
