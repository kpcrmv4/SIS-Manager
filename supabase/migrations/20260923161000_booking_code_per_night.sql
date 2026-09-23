-- BK-MMDD-NNN repeats every year: the code is unique within a branch's NIGHT, not forever.
-- (P1-03 had unique (branch_id, code), which next year's first booking on the same date would hit.)
alter table public.bookings drop constraint if exists bookings_branch_id_code_key;
create unique index if not exists bookings_branch_night_code_uniq on public.bookings (branch_id, night, code);
