-- Migration: Add biteship.webhook_secret to integration config keys
-- Purpose: Allow admins to manage the Biteship webhook secret token from
-- Settings → Pengiriman, stored securely via Vault like other provider secrets.

insert into private.integration_config_keys (
  key_name,
  display_name,
  description,
  value_kind,
  is_secret,
  is_required,
  is_runtime_required,
  default_non_secret_value,
  validation_rules
)
values
  (
    'biteship.webhook_secret',
    'Biteship webhook secret',
    'Token rahasia untuk memvalidasi request webhook dari Biteship. Tambahkan sebagai parameter ?secret= pada URL webhook.',
    'secret',
    true,
    false,
    false,
    null,
    '{"provider":"biteship"}'::jsonb
  )
on conflict (key_name) do update
set
  display_name = excluded.display_name,
  description = excluded.description,
  value_kind = excluded.value_kind,
  is_secret = excluded.is_secret,
  is_required = excluded.is_required,
  is_runtime_required = excluded.is_runtime_required,
  default_non_secret_value = excluded.default_non_secret_value,
  validation_rules = excluded.validation_rules,
  updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now());
