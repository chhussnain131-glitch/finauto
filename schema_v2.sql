-- Run this in Supabase SQL Editor to add the reminders table.
-- (transactions table already exists from schema.sql)

create table if not exists public.reminders (
  id         bigint generated always as identity primary key,
  name       text not null,
  category   text not null,
  amount     numeric(12, 2),
  due_day    integer not null check (due_day between 1 and 31),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.reminders disable row level security;
