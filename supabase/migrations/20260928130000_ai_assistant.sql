-- R-070 (owner, 2026-09-28): an AI assistant inside the staff app. Phase 1 answers how-to
-- questions from the manual and looks things up; it never changes data. It reads with the
-- signed-in user's own session, so RLS and the role checks decide what it can see.
--   ai_settings  one row: which roles may open it, which model — every member reads it
--                (the button shows only where it is on), only the owner writes it
--   ai_secrets   the Anthropic API key — no policy for authenticated: the service role only
--   ai_usage     one row per answer: tokens, so the owner sees what it costs

create table if not exists public.ai_settings (
  id boolean primary key default true check (id),
  enabled_roles public.user_role[] not null default '{staff,bar,owner}',
  model text not null default 'claude-opus-5' check (model ~ '^[a-z0-9][a-z0-9.:@_-]{2,79}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.ai_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.ai_secrets (
  id boolean primary key default true check (id),
  api_key text not null check (length(api_key) between 20 and 300),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete set null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  tool_calls integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_created on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_created on public.ai_usage (created_at desc);

alter table public.ai_settings enable row level security;
alter table public.ai_secrets enable row level security;
alter table public.ai_usage enable row level security;

revoke all on public.ai_settings, public.ai_secrets, public.ai_usage from public, anon, authenticated;
grant select, update on public.ai_settings to authenticated;
grant select on public.ai_usage to authenticated;

create policy ai_settings_select on public.ai_settings for select to authenticated using (true);
create policy ai_settings_update on public.ai_settings for update to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
-- ai_secrets: no policy at all — authenticated reads and writes nothing
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_owner()));
