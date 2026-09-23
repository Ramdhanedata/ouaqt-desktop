-- A medicine sold past its expiry date.
--
-- The pharmacist is warned, with the product and the date, and may go ahead:
-- refusing outright only teaches him to sell around the software. What he
-- decided is written on the line, so it can be seen later in the reports.

alter table sale_lines add column past_expiry integer not null default 0;
