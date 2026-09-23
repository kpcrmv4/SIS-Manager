-- P5-02 performance advisors: index the foreign keys that sit on real paths — cascading
-- deletes from deposits (print_jobs), branch-scoped cleanup and lookups (line_outbox,
-- notifications), zone deletes / FK checks (bookings.zone_id) and a customer's withdrawals.
-- The remaining unindexed FKs are *_by → profiles audit columns: only a profile DELETE would
-- scan them, and profiles are deactivated, never deleted (RULINGS R-027).
create index if not exists print_jobs_deposit_idx on public.print_jobs (deposit_id);
create index if not exists line_outbox_branch_idx on public.line_outbox (branch_id);
create index if not exists notifications_branch_idx on public.notifications (branch_id);
create index if not exists bookings_zone_idx on public.bookings (zone_id) where zone_id is not null;
create index if not exists withdrawals_customer_idx on public.withdrawals (customer_id) where customer_id is not null;
