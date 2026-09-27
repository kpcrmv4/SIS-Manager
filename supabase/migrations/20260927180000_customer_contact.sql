-- R-065 · (owner request) the LIFF forms remember the customer: the name and phone a customer last gave
-- (on a deposit request or a booking) are kept on their customers row and filled in next time; the
-- customer may change them, and what they send becomes the new remembered value. contact_name is the
-- name they go by at the shop — display_name stays their LINE name. The phone uses the format the
-- deposits and bookings accept. Written by the customer API routes only (service role).

alter table public.customers add column if not exists contact_name text check (contact_name is null or length(btrim(contact_name)) between 1 and 120);
comment on column public.customers.contact_name is 'R-065: the name this customer last gave on a LIFF form (their LINE name is display_name).';
do $$ begin
  alter table public.customers add constraint customers_phone_format check (phone is null or phone ~ '^[0-9+\- ]{6,20}$');
exception when duplicate_object then null; end $$;
