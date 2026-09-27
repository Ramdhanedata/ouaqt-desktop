-- A pharmacy conventionnée with a health fund (CNAM, CNASS, a private
-- insurer): the fund pays part of a sale, the customer pays the rest, and
-- the pharmacy claims the fund's part at the end of the month.
--
-- The part is kept on the sale with the fund, the insured's number and the
-- share applied, so the receipt, the drawer and the claim all read the sale
-- itself. A sale no fund paid into has none of it and covered is 0, which is
-- every sale made before this and every sale of every other trade.
alter table sales add column cover_payer text check (cover_payer in ('cnam', 'cnass', 'other'));
alter table sales add column cover_member text;
alter table sales add column cover_share integer;
alter table sales add column covered integer not null default 0;

-- What each sale brought in, by way of paying. The fund's part is not the
-- customer's: it leaves his way of paying and is its own line, "insurance",
-- which the drawer never counts and the reports show apart. Everything else
-- reads as it did.
drop view if exists sale_takings;
create view sale_takings as
  select s.id as sale_id, s.occurred_at, s.payment as method, s.mobile_app,
         s.total - s.covered as amount, s.total - s.prepaid - s.covered as due
    from sales s
   where not exists (select 1 from sale_payments p where p.sale_id = s.id)
  union all
  select p.sale_id, s.occurred_at, p.method, p.mobile_app, p.amount, p.amount
    from sale_payments p join sales s on s.id = p.sale_id
  union all
  select s.id, s.occurred_at, 'insurance', null, s.covered, s.covered
    from sales s
   where s.covered <> 0;
