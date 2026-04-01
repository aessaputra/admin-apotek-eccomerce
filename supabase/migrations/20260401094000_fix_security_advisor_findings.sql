begin;

alter view public.report_daily_sales set (security_invoker = true);
alter view public.report_customer_sales set (security_invoker = true);
alter view public.report_product_sales set (security_invoker = true);

create or replace function public.update_orders_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

create or replace function public.update_payments_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

alter table public.webhook_side_effect_tasks enable row level security;
alter table public.order_item_stock_deductions enable row level security;

drop policy if exists "No direct access to webhook side effect tasks" on public.webhook_side_effect_tasks;
create policy "No direct access to webhook side effect tasks"
  on public.webhook_side_effect_tasks
  as restrictive
  for all
  to authenticated, anon
  using (false)
  with check (false);

drop policy if exists "No direct access to order item stock deductions" on public.order_item_stock_deductions;
create policy "No direct access to order item stock deductions"
  on public.order_item_stock_deductions
  as restrictive
  for all
  to authenticated, anon
  using (false)
  with check (false);

drop policy if exists "Allow authenticated users to update settings" on public.settings;
create policy "Allow authenticated users to update settings"
  on public.settings
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Service role can manage webhook_idempotency" on public.webhook_idempotency;
drop policy if exists "No direct access to webhook idempotency" on public.webhook_idempotency;
create policy "No direct access to webhook idempotency"
  on public.webhook_idempotency
  as restrictive
  for all
  to authenticated, anon
  using (false)
  with check (false);

commit;
