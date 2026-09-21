-- The shop's own database. It never leaves his computers.
--
-- Two rules shape every table here, and both come from the brief:
--
--   Stock is movements, never a stored total. Sold 2, received 50, adjusted
--   minus 1: each is a row, and the quantity on hand is their sum. That is
--   what makes merging two tills safe, and what lets any figure be traced
--   back to what caused it.
--
--   A row that records an event is never updated in place. A voided sale is a
--   new row that reverses it, with a reason and the person who did it. The
--   original stays, because it happened.
--
-- Every table carries id, device_id, created_at and counter. The counter is
-- what sync uses to know what a peer has not seen yet.

create table if not exists products (
  id                text primary key,
  device_id         text not null,
  created_at        text not null,
  counter           integer not null,
  name              text not null,
  name_arabic       text,
  barcode           text,
  unit              text,
  -- Money is an integer in minor units. 1 MRU is 100. Never a float.
  sale_price        integer not null,
  cost_price        integer,
  low_stock         integer,
  -- Pack-specific fields live here rather than in columns nobody else uses.
  extra             text,
  archived_at       text
);
create index if not exists products_name_idx on products (name);
create index if not exists products_barcode_idx on products (barcode);

create table if not exists stock_movements (
  id           text primary key,
  device_id    text not null,
  created_at   text not null,
  counter      integer not null,
  product_id   text not null references products (id),
  -- Positive for what comes in, negative for what goes out.
  quantity     real not null,
  reason       text not null check (reason in ('sale', 'reception', 'adjustment', 'expiry', 'return', 'transfer')),
  reference    text,
  staff_id     text,
  occurred_at  text not null
);
create index if not exists movements_product_idx on stock_movements (product_id, occurred_at);

create table if not exists sales (
  id            text primary key,
  device_id     text not null,
  created_at    text not null,
  counter       integer not null,
  number        integer not null,
  occurred_at   text not null,
  staff_id      text,
  total         integer not null,
  payment       text not null check (payment in ('cash', 'credit', 'mobile')),
  customer_id   text,
  status        text not null default 'recorded' check (status in ('recorded', 'voided')),
  -- A void is its own row pointing back at what it reverses.
  reverses_id   text references sales (id),
  void_reason   text
);
create index if not exists sales_occurred_idx on sales (occurred_at);

create table if not exists sale_lines (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  sale_id     text not null references sales (id),
  product_id  text not null references products (id),
  quantity    real not null,
  unit_price  integer not null,
  line_total  integer not null,
  batch_id    text
);
create index if not exists sale_lines_sale_idx on sale_lines (sale_id);

create table if not exists customers (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  name        text not null,
  phone       text
);

-- The credit balance is the sum of this ledger, never a column somebody
-- remembers to update.
create table if not exists credit_entries (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  customer_id text not null references customers (id),
  sale_id     text references sales (id),
  -- Positive when he owes more, negative when he pays.
  amount      integer not null,
  staff_id    text,
  occurred_at text not null
);
create index if not exists credit_customer_idx on credit_entries (customer_id, occurred_at);

create table if not exists cash_sessions (
  id            text primary key,
  device_id     text not null,
  created_at    text not null,
  counter       integer not null,
  opened_at     text not null,
  closed_at     text,
  opening_float integer not null default 0,
  counted       integer,
  expected      integer,
  difference    integer,
  note          text,
  staff_id      text
);

create table if not exists staff (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  name        text not null,
  role        text not null check (role in ('manager', 'cashier')),
  -- Argon2id or bcrypt. Never the code itself.
  pin_hash    text,
  active      integer not null default 1
);

create table if not exists suppliers (
  id         text primary key,
  device_id  text not null,
  created_at text not null,
  counter    integer not null,
  name       text not null,
  phone      text
);

create table if not exists receptions (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  supplier_id text references suppliers (id),
  occurred_at text not null,
  note        text
);

-- What the app was told by its licence and its configuration, plus the
-- settings the owner sets on this machine.
create table if not exists settings_local (
  key        text primary key,
  value      text not null,
  updated_at text not null
);

-- Per peer: what has been exchanged, so a reconnection sends only the rest.
create table if not exists sync_state (
  peer_id       text primary key,
  peer_name     text,
  last_sent     integer not null default 0,
  last_received integer not null default 0,
  last_seen_at  text
);

-- Who did what. The owner can read it; a cashier cannot.
create table if not exists audit_local (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  staff_id    text,
  subject     text not null,
  subject_id  text,
  action      text not null,
  detail      text
);
create index if not exists audit_created_idx on audit_local (created_at desc);
