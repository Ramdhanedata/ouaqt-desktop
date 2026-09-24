-- A debt paid through an application says which one, like a sale does, so
-- the drawer screen and the reports can say what landed on each account.
alter table credit_entries add column mobile_app text;
alter table credit_entries add column payment_reference text;
