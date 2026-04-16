begin;

create table if not exists public.storage_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('dry-run', 'delete')),
  status text not null check (status in ('running', 'succeeded', 'failed')),
  trigger_source text not null default 'manual',
  started_at timestamptz not null default timezone('utc'::text, now()),
  finished_at timestamptz,
  referenced_count integer not null default 0 check (referenced_count >= 0),
  orphan_count integer not null default 0 check (orphan_count >= 0),
  deleted_count integer not null default 0 check (deleted_count >= 0),
  invalid_reference_count integer not null default 0 check (invalid_reference_count >= 0),
  sample_orphans jsonb not null default '[]'::jsonb,
  sample_invalid_references jsonb not null default '[]'::jsonb,
  error_message text,
  request_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.storage_cleanup_runs is
  'Execution history for cleanup-orphan-storage dry-run and delete jobs.';

comment on column public.storage_cleanup_runs.sample_orphans is
  'Bounded list of orphan storage paths reported by a cleanup run.';

comment on column public.storage_cleanup_runs.sample_invalid_references is
  'Bounded list of invalid media references reported by a cleanup run.';

create index if not exists storage_cleanup_runs_status_started_at_idx
  on public.storage_cleanup_runs (status, started_at desc);

create index if not exists storage_cleanup_runs_finished_at_idx
  on public.storage_cleanup_runs (finished_at desc nulls last);

alter table public.storage_cleanup_runs enable row level security;

drop policy if exists "Admins can read storage cleanup runs" on public.storage_cleanup_runs;
create policy "Admins can read storage cleanup runs"
  on public.storage_cleanup_runs
  for select
  to authenticated
  using ((select private.is_admin()));

commit;
