-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query)
-- to create the table this app reads and writes.

create table if not exists public.transactions (
  id          bigint generated always as identity primary key,
  amount      numeric(12, 2) not null check (amount > 0),
  category    text not null,
  type        text not null check (type in ('Income', 'Expense')),
  date        date not null default current_date,
  note        text,
  created_at  timestamptz not null default now()
);

-- Speeds up the default "newest first" sort used by the dashboard.
create index if not exists transactions_date_idx
  on public.transactions (date desc);

-- This app only ever talks to Supabase through the SERVICE ROLE key from a
-- trusted Flask backend (never from the browser), so Row Level Security can
-- safely stay off for this single-user table. If you ever query this table
-- with the anon/public key directly from client-side JS, enable RLS first
-- and add an explicit policy.
alter table public.transactions disable row level security;
