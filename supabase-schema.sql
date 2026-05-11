-- Run this in Supabase Dashboard → SQL Editor

-- Tasks table (replaces tasks/open.md file)
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  done boolean not null default false,
  source text not null default 'manual', -- manual | meeting | email | ai
  contact_name text,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Conversations table (persistent chat memory)
create table if not exists conversations (
  id text primary key, -- 'main' for single-user
  messages jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- Meeting reports table (structured meeting data)
create table if not exists meeting_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  date date not null,
  attendees text,
  summary text not null,
  action_items text,
  drive_url text,        -- Google Drive doc link
  contact_name text,
  contact_email text,
  created_at timestamptz not null default now()
);

-- Indexes for common queries
create index if not exists tasks_done_idx on tasks(done, created_at desc);
create index if not exists meeting_reports_date_idx on meeting_reports(created_at desc);
