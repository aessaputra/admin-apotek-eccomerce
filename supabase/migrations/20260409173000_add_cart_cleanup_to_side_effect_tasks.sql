begin;

alter table public.webhook_side_effect_tasks
  add column if not exists needs_cart_cleanup boolean not null default false;

comment on column public.webhook_side_effect_tasks.needs_cart_cleanup is
  'Whether settlement side effects still need to clear the user cart before the task can be considered complete.';

create index if not exists webhook_side_effect_tasks_cart_cleanup_idx
  on public.webhook_side_effect_tasks (needs_cart_cleanup)
  where needs_cart_cleanup = true;

commit;
