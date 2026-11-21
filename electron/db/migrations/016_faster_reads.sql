-- Indexes for a shop that has been selling for a while.
--
-- Each new sale, order, ticket or stay took its number from max(number) over
-- the whole table. Nothing indexed that column, so every sale read every sale
-- before it: a till that was quick in its first week got slower each month.
-- With an index the last number is one look-up, whatever the history.
create index if not exists sales_number_idx on sales (number);
create index if not exists orders_number_idx on orders (number);
create index if not exists preorders_number_idx on preorders (number);
create index if not exists stays_number_idx on stays (number);
create index if not exists tickets_number_idx on tickets (number);
create index if not exists wash_jobs_number_idx on wash_jobs (number);
create index if not exists dispatches_number_idx on dispatches (number);

-- Stock on hand is the sum of a product's movements, and what is left in a
-- batch the sum of that batch's. With the quantity inside the index, SQLite
-- adds them up from the index alone instead of fetching every movement row.
-- The batch index replaces the one that held the batch alone.
create index if not exists movements_product_quantity_idx on stock_movements (product_id, quantity);
drop index if exists movements_batch_idx;
create index if not exists movements_batch_quantity_idx on stock_movements (batch_id, quantity);

analyze;
