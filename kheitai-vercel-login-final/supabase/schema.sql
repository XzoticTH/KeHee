create table if not exists public.users (
  id text primary key,
  password_hash text not null,
  password_salt text not null,
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  active boolean not null default true,
  password_version integer not null default 1
);
create index if not exists users_role_idx on public.users(role);
create index if not exists users_active_idx on public.users(active);
alter table public.users enable row level security;
-- API uses the server-only service role key; do not expose that key to the browser.
