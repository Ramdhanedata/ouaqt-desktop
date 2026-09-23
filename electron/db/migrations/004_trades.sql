-- What the other trades need from the shared core, and their own records.
--
-- Two tables are rebuilt rather than altered, because SQLite cannot change a
-- column's rule in place: stock movements gain the reasons a bakery and a
-- warehouse need (production, loss, dispatch) and a location, and sale lines
-- may now be a service rather than a product (a night in a room, a seat on a
-- bus, a parcel's fee). Every row is copied across as it was; nothing
-- recorded is rewritten.

-- ── Stock movements, with production, losses, dispatches and locations ──

create table stock_movements_next (
  id           text primary key,
  device_id    text not null,
  created_at   text not null,
  counter      integer not null,
  product_id   text not null references products (id),
  quantity     real not null,
  reason       text not null check (reason in ('sale', 'reception', 'adjustment', 'expiry', 'return', 'transfer', 'production', 'loss', 'dispatch')),
  reference    text,
  staff_id     text,
  occurred_at  text not null,
  batch_id     text references batches (id),
  location_id  text
);
insert into stock_movements_next (id, device_id, created_at, counter, product_id, quantity, reason, reference, staff_id, occurred_at, batch_id)
  select id, device_id, created_at, counter, product_id, quantity, reason, reference, staff_id, occurred_at, batch_id from stock_movements;
drop table stock_movements;
alter table stock_movements_next rename to stock_movements;
create index movements_product_idx on stock_movements (product_id, occurred_at);
create index movements_batch_idx on stock_movements (batch_id);
create index movements_location_idx on stock_movements (location_id, product_id);
create index movements_reference_idx on stock_movements (reference);

-- ── Sale lines that are a service, not a product ────────────────────────

create table sale_lines_next (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  sale_id     text not null references sales (id),
  product_id  text references products (id),
  quantity    real not null,
  unit_price  integer not null,
  line_total  integer not null,
  batch_id    text,
  -- What the line says when it is not a product: "Chambre 12, 3 nuits".
  label       text,
  -- product, service, room, ticket, parcel
  kind        text not null default 'product',
  reference   text
);
insert into sale_lines_next (id, device_id, created_at, counter, sale_id, product_id, quantity, unit_price, line_total, batch_id)
  select id, device_id, created_at, counter, sale_id, product_id, quantity, unit_price, line_total, batch_id from sale_lines;
drop table sale_lines;
alter table sale_lines_next rename to sale_lines;
create index sale_lines_sale_idx on sale_lines (sale_id);
create index sale_lines_product_idx on sale_lines (product_id);

-- Part of a sale's total already received before it was recorded: a
-- bakery's deposit, a hotel guest's advance. The till counted that money
-- when it came in, so it is not counted again at the sale.
alter table sales add column prepaid integer not null default 0;
-- The record the sale settles: a table's order, a stay, a preorder.
alter table sales add column reference text;

-- A menu item or a service is sold without being counted on a shelf.
alter table products add column tracked integer not null default 1;

-- ── Money in and out of the drawer that is not a sale ───────────────────

create table if not exists cash_movements (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  occurred_at text not null,
  direction   text not null check (direction in ('in', 'out')),
  amount      integer not null check (amount > 0),
  payment     text not null default 'cash' check (payment in ('cash', 'mobile')),
  -- expense, withdrawal, deposit, deposit_refund, advance, float_added, other
  reason      text not null,
  category    text,
  note        text,
  reference   text,
  staff_id    text
);
create index if not exists cash_movements_idx on cash_movements (occurred_at);

-- ── Warehouse: places goods are kept, and notes for goods leaving ───────

create table if not exists locations (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  name        text not null,
  archived_at text
);

create table if not exists dispatches (
  id            text primary key,
  device_id     text not null,
  created_at    text not null,
  counter       integer not null,
  number        integer not null,
  occurred_at   text not null,
  -- customer, my_shop, site
  destination   text not null,
  recipient     text not null,
  location_id   text,
  sale_id       text,
  note          text,
  staff_id      text
);

-- ── Restaurant: an order kept open while the table eats ─────────────────

create table if not exists orders (
  id           text primary key,
  device_id    text not null,
  created_at   text not null,
  counter      integer not null,
  number       integer not null,
  -- dine_in, takeaway, delivery
  service      text not null,
  table_no     integer,
  guests       integer,
  customer     text,
  phone        text,
  address      text,
  status       text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  opened_at    text not null,
  closed_at    text,
  sale_id      text,
  note         text,
  staff_id     text
);
create index if not exists orders_status_idx on orders (status, table_no);

create table if not exists order_lines (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  order_id    text not null references orders (id),
  product_id  text not null references products (id),
  quantity    real not null,
  unit_price  integer not null,
  note        text,
  sent_at     text,
  cancelled_at text
);
create index if not exists order_lines_order_idx on order_lines (order_id);

-- ── Bakery: orders taken ahead, with a deposit ──────────────────────────

create table if not exists preorders (
  id           text primary key,
  device_id    text not null,
  created_at   text not null,
  counter      integer not null,
  number       integer not null,
  customer     text not null,
  phone        text,
  due_on       text not null,
  total        integer not null,
  deposit      integer not null default 0,
  status       text not null default 'pending' check (status in ('pending', 'ready', 'collected', 'cancelled')),
  sale_id      text,
  note         text,
  staff_id     text
);
create index if not exists preorders_due_idx on preorders (status, due_on);

create table if not exists preorder_lines (
  id           text primary key,
  device_id    text not null,
  created_at   text not null,
  counter      integer not null,
  preorder_id  text not null references preorders (id),
  product_id   text not null references products (id),
  quantity     real not null,
  unit_price   integer not null
);

-- ── Hotel: rooms, stays and what is charged to them ─────────────────────

create table if not exists rooms (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  number      text not null,
  kind        text,
  rate        integer not null,
  capacity    integer not null default 2,
  -- available, cleaning, out_of_service; occupied is read from the stays
  status      text not null default 'available',
  archived_at text
);

create table if not exists stays (
  id            text primary key,
  device_id     text not null,
  created_at    text not null,
  counter       integer not null,
  number        integer not null,
  room_id       text not null references rooms (id),
  guest         text not null,
  phone         text,
  id_document   text,
  nationality   text,
  adults        integer not null default 1,
  arrives_on    text not null,
  leaves_on     text not null,
  checked_in_at  text,
  checked_out_at text,
  rate          integer not null,
  status        text not null default 'reserved' check (status in ('reserved', 'in', 'out', 'cancelled')),
  sale_id       text,
  note          text,
  staff_id      text
);
create index if not exists stays_room_idx on stays (room_id, status);

create table if not exists stay_charges (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  stay_id     text not null references stays (id),
  label       text not null,
  quantity    real not null default 1,
  unit_price  integer not null,
  occurred_at text not null
);

-- ── Transport: routes, trips, seats and parcels ─────────────────────────

create table if not exists routes (
  id           text primary key,
  device_id    text not null,
  created_at   text not null,
  counter      integer not null,
  origin       text not null,
  destination  text not null,
  fare         integer not null,
  parcel_fee   integer,
  archived_at  text
);

create table if not exists vehicles (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  plate       text not null,
  seats       integer not null,
  archived_at text
);

create table if not exists trips (
  id           text primary key,
  device_id    text not null,
  created_at   text not null,
  counter      integer not null,
  route_id     text not null references routes (id),
  vehicle_id   text references vehicles (id),
  driver       text,
  departs_at   text not null,
  seats        integer not null,
  status       text not null default 'scheduled' check (status in ('scheduled', 'departed', 'arrived', 'cancelled')),
  note         text
);
create index if not exists trips_departs_idx on trips (departs_at);

create table if not exists tickets (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  number      integer not null,
  trip_id     text not null references trips (id),
  seat        integer,
  passenger   text not null,
  phone       text,
  fare        integer not null,
  status      text not null default 'sold' check (status in ('sold', 'boarded', 'cancelled')),
  sale_id     text,
  staff_id    text
);
create index if not exists tickets_trip_idx on tickets (trip_id, status);

create table if not exists parcels (
  id            text primary key,
  device_id     text not null,
  created_at    text not null,
  counter       integer not null,
  code          text not null unique,
  trip_id       text references trips (id),
  route_id      text references routes (id),
  sender        text not null,
  sender_phone  text,
  receiver      text not null,
  receiver_phone text,
  description   text,
  weight        real,
  fee           integer not null,
  -- sender pays now, receiver pays on collection
  paid_by       text not null default 'sender' check (paid_by in ('sender', 'receiver')),
  status        text not null default 'received' check (status in ('received', 'loaded', 'arrived', 'delivered', 'cancelled')),
  sale_id       text,
  delivered_at  text,
  staff_id      text
);
create index if not exists parcels_status_idx on parcels (status, trip_id);
