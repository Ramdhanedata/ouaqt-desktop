-- The counter of a restaurant or a café, as the owner's own app ran it.

-- One bill paid two ways: part in cash, part through an application. The
-- sale keeps "cash" as its kind, since the drawer is involved, and its parts
-- are written here. A sale with no parts is paid entirely its own way.
create table if not exists sale_payments (
  id                 text primary key,
  device_id          text not null,
  created_at         text not null,
  counter            integer not null,
  sale_id            text not null references sales (id),
  method             text not null check (method in ('cash', 'mobile')),
  mobile_app         text,
  payment_reference  text,
  amount             integer not null
);
create index if not exists sale_payments_sale_idx on sale_payments (sale_id);

-- What each sale brought in, by way of paying: the drawer, the reports and
-- the per-app totals all read this, so a split bill is counted in its parts.
-- "due" leaves out what was received beforehand, as the drawer does.
create view if not exists sale_takings as
  select s.id as sale_id, s.occurred_at, s.payment as method, s.mobile_app,
         s.total as amount, s.total - s.prepaid as due
    from sales s
   where not exists (select 1 from sale_payments p where p.sale_id = s.id)
  union all
  select p.sale_id, s.occurred_at, p.method, p.mobile_app, p.amount, p.amount
    from sale_payments p join sales s on s.id = p.sale_id;

-- A debt account, as the app kept them for companies: who to call, how
-- often it is billed and from when.
alter table customers add column contact text;
alter table customers add column billing text;
alter table customers add column billing_start text;

-- Who ate on the account: the company pays, the employee's name is on the line.
alter table sales add column employee text;

-- An order held with its account already chosen.
alter table orders add column customer_id text;
alter table orders add column employee text;
