-- Fix RLS policy on orders table to use TO authenticated instead of TO public
-- The role "public" includes unauthenticated users which can cause issues with auth.uid() comparisons

begin;
-- Drop the existing policy with incorrect role
drop policy if exists "Users can view their own orders" on public.orders;
-- Recreate the policy with correct role
create policy "Users can view their own orders"
  on public.orders
  for select
  to authenticated
  using (auth.uid() = user_id);
commit;
