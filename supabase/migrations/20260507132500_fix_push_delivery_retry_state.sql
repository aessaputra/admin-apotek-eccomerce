begin;

update public.notification_push_deliveries
set
  receipt_id = null,
  updated_at = timezone('utc'::text, now())
where receipt_id is not null
  and delivered_at is null
  and failed_at is null
  and next_retry_at is not null
  and coalesce(error_code, '') <> 'DeviceNotRegistered';

update public.notification_push_deliveries
set
  next_retry_at = null,
  updated_at = timezone('utc'::text, now())
where failed_at is not null
  and next_retry_at is not null;

commit;
