create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  store_name text,
  platform text,
  platform_confidence numeric(5,2) not null default 0,
  category text,
  country text,
  review_signal boolean not null default false,
  review_platform text,
  feedback_signal boolean not null default false,
  commerce_signal boolean not null default false,
  discovery_source text,
  source_url text,
  qualification_score integer not null default 0 check (qualification_score between 0 and 100),
  status text not null default 'discovered' check (status in ('discovered','qualified','rejected','researched','priority')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prospect_sources (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  source_type text not null,
  source_url text not null,
  source_title text,
  query text,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.prospect_signals (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  signal_type text not null,
  signal_value text,
  confidence numeric(5,2) not null default 0,
  evidence_url text,
  evidence_text text,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists prospects_status_idx on public.prospects(status);
create index if not exists prospects_score_idx on public.prospects(qualification_score desc);
create index if not exists prospect_sources_prospect_idx on public.prospect_sources(prospect_id);
create index if not exists prospect_signals_prospect_idx on public.prospect_signals(prospect_id);

alter table public.prospects enable row level security;
alter table public.prospect_sources enable row level security;
alter table public.prospect_signals enable row level security;
