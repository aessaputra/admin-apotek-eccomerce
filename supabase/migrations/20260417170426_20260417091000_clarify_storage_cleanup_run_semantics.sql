begin;

alter table public.storage_cleanup_runs
  drop constraint if exists storage_cleanup_runs_terminal_status_requires_finished_at;

alter table public.storage_cleanup_runs
  add constraint storage_cleanup_runs_terminal_status_requires_finished_at
  check (status = 'running' or finished_at is not null);

comment on column public.storage_cleanup_runs.deleted_count is
  'Backward-compatible count of orphaned files processed during a cleanup run. In the current quarantine-based flow this matches quarantined_count until permanent deletion is introduced.';

comment on column public.storage_cleanup_runs.quarantined_count is
  'Canonical count of orphaned files moved into quarantine during a cleanup run.';

comment on column public.storage_cleanup_runs.request_payload is
  'Snapshot of operator or scheduler inputs used to start the cleanup run, retained for audit and reproducibility.';

comment on column public.storage_cleanup_runs.created_at is
  'Audit timestamp recording when the cleanup run row was inserted. started_at records when execution began.';

commit;
