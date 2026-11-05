-- A wash: cars, upholstery and carpets, or both.
--
-- Each job waits, is washed, is ready, and is paid or cancelled. Its services
-- are products that are not counted, so the owner names and prices them on
-- the same screen a restaurant's menu uses. A car is plate and vehicle; a
-- sofa is a customer, a phone and a date to come back. An advance is money in
-- the cash book with the job as its reference, as a bakery's deposit is.

create table if not exists wash_jobs (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  number      integer not null,
  kind        text not null check (kind in ('car', 'upholstery')),
  status      text not null default 'waiting'
              check (status in ('waiting', 'washing', 'ready', 'paid', 'cancelled')),
  plate       text,
  vehicle     text,
  customer    text,
  phone       text,
  due_on      text,
  washer      text,
  note        text,
  started_at  text,
  ready_at    text,
  closed_at   text,
  sale_id     text references sales (id)
);

create index if not exists wash_jobs_status_idx on wash_jobs (status, number);
create index if not exists wash_jobs_closed_idx on wash_jobs (closed_at);

create table if not exists wash_job_lines (
  id          text primary key,
  device_id   text not null,
  created_at  text not null,
  counter     integer not null,
  job_id      text not null references wash_jobs (id),
  product_id  text not null references products (id),
  quantity    real not null,
  unit_price  integer not null
);

create index if not exists wash_job_lines_job_idx on wash_job_lines (job_id);
