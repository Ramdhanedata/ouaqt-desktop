-- The payment applications an owner takes money through, as he keeps them.
--
-- He adds, renames, reorders and removes them himself, in Settings, without
-- waiting for a release: a pharmacy in Nouakchott keeps Bankily and Masrvi,
-- a shop in Dakar adds Wave and Orange Money. It lives here, with his data,
-- so an update never resets it and a backup carries it.
--
-- Removing one only marks it inactive: a sale made through it last month
-- still names it, because the sale keeps the name it was made under.

create table if not exists payment_apps (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  name        text not null,
  -- A small picture, which an owner recognises faster than the word. Optional.
  logo        text,
  position    integer not null,
  active      integer not null default 1
);

-- The five most early owners use. Any of them can be removed.
insert or ignore into payment_apps (id, device_id, created_at, counter, name, position) values
  ('bankily', 'seed', '2026-09-24T00:00:00.000Z', 0, 'Bankily', 1),
  ('masrvi',  'seed', '2026-09-24T00:00:00.000Z', 0, 'Masrvi',  2),
  ('sedad',   'seed', '2026-09-24T00:00:00.000Z', 0, 'SEDAD',   3),
  ('bimbank', 'seed', '2026-09-24T00:00:00.000Z', 0, 'BimBank', 4),
  ('click',   'seed', '2026-09-24T00:00:00.000Z', 0, 'Click',   5);

-- The transaction number the customer's app showed, when the cashier notes it.
alter table sales add column payment_reference text;
