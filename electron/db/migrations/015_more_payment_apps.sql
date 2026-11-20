-- Three more payment applications shops in Mauritania take money through:
-- BCIpay, GazaPay and Amanty. The app now carries the marks of all eight, so
-- the list offers them too, after whatever the owner already keeps. Like the
-- first five, any of them can be removed in Settings, and one he already
-- added, or removed, under the same name is left as it is.

insert or ignore into payment_apps (id, device_id, created_at, counter, name, position)
select * from (
  select 'bcipay', 'seed', '2026-11-20T00:00:00.000Z', 0, 'BCIpay', coalesce(max(position), 0) + 1 from payment_apps
)
where not exists (select 1 from payment_apps where lower(name) = 'bcipay');

insert or ignore into payment_apps (id, device_id, created_at, counter, name, position)
select * from (
  select 'gazapay', 'seed', '2026-11-20T00:00:00.000Z', 0, 'GazaPay', coalesce(max(position), 0) + 1 from payment_apps
)
where not exists (select 1 from payment_apps where lower(name) = 'gazapay');

insert or ignore into payment_apps (id, device_id, created_at, counter, name, position)
select * from (
  select 'amanty', 'seed', '2026-11-20T00:00:00.000Z', 0, 'Amanty', coalesce(max(position), 0) + 1 from payment_apps
)
where not exists (select 1 from payment_apps where lower(name) = 'amanty');
