-- รันไฟล์นี้ได้ทันทีใน Supabase SQL Editor
-- สร้างตารางก่อน แล้วจึงสร้างบัญชีผู้ดูแล: Admingod / 445566
create table if not exists public.users (
  id text primary key,
  password_hash text not null,
  password_salt text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  active boolean not null default true,
  password_version integer not null default 1
);

create index if not exists users_role_idx on public.users(role);
create index if not exists users_active_idx on public.users(active);
alter table public.users enable row level security;

-- password_hash และ password_salt สร้างด้วย Node.js scrypt
insert into public.users
  (id, password_hash, password_salt, role, created_at, expires_at, active, password_version)
values
  ('Admingod',
   '1CB06paH_2rT3NeOTHU3bJecXNK02ywIjMg43UNZ0XdWASk4s0Yp7kobe7g5Nb-U7WCXKX98_BfmuoOkIJBFIw',
   '273949bd4686ba136098a580bfe73376',
   'admin', now(), null, true, 1)
on conflict (id) do update set
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt,
  role = 'admin',
  active = true,
  expires_at = null,
  password_version = public.users.password_version + 1;
