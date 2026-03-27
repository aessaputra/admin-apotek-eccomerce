begin;
alter table public.webhook_side_effect_tasks
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_until timestamptz;
create index if not exists webhook_side_effect_tasks_lease_idx
  on public.webhook_side_effect_tasks (lease_until);
commit;
