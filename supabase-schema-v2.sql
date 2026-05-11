-- Run this in Supabase Dashboard → SQL Editor
-- Phase 2 additions: Content Pipeline + Delegation Tracker

-- Content Pipeline table
create table if not exists content_pipeline (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null, -- 'linkedin' | 'reel' | 'blog' | 'email' | 'other'
  platform text,      -- 'linkedin' | 'instagram' | 'website' | 'newsletter'
  status text not null default 'idea', -- 'idea' | 'drafting' | 'ready' | 'scheduled' | 'published'
  scheduled_date date,
  published_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Delegation Tracker table
create table if not exists delegations (
  id uuid primary key default gen_random_uuid(),
  task text not null,
  assigned_to text not null,   -- employee/intern name
  assigned_by text default 'Siamak',
  due_date date,
  status text not null default 'assigned', -- 'assigned' | 'in_progress' | 'done' | 'overdue'
  notes text,
  nudge_count int default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_status_idx on content_pipeline(status, scheduled_date);
create index if not exists delegations_status_idx on delegations(status, due_date);
