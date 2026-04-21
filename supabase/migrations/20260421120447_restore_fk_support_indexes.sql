begin;

create index if not exists shipments_waybill_overridden_by_idx
  on public.shipments (waybill_overridden_by)
  where waybill_overridden_by is not null;

create index if not exists idx_order_item_stock_deductions_product_id
  on public.order_item_stock_deductions (product_id);

commit;
