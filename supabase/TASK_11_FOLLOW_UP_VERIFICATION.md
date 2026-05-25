# Task 11 Follow-up Verification

## Scope

This file records local-safe Task 11 decisions and the exact follow-up checks that require explicit production read-only approval. Do not run the live Supabase checks below from an unapproved remediation session.

## Local Decisions

- `claim_profile_push_token`: keep as an intentional authenticated `SECURITY DEFINER` exception for signed-in customer Expo push-token registration. Local migrations show `auth.uid()` ownership binding, `SET search_path = ''`, Expo token format validation, conflict revocation limited to active duplicate tokens, and grants restricted to `authenticated` after revoking `public`, `anon`, and `service_role`. No new grant migration is justified without a product decision to move registration behind an Edge Function.
- Auth leaked password protection: owner-managed. It must be enabled or formally waived in Supabase Dashboard/Auth settings by a project owner; local source cannot verify or change this without approved production access.
- Deployment drift: production provenance for `create-checkout-order` remains a release-window follow-up because this session has no approval to read live function inventory.
- Index review: no drops are approved from the sanitized `unused_index` advisor signal. Keep or defer every affected path until a redacted index-level export and query-path review are available.

## Approved-session Commands Only

Run these only after credentials and explicit read-only approval are available:

```bash
# Discover CLI shape before inventory commands.
npx supabase functions list --help

# Production deployment inventory. Save only sanitized slug/version/status/entrypoint/import-map metadata.
npx supabase functions list --output json

# Local config comparison, safe without production credentials.
rg -n '^\[functions\.|^verify_jwt\s*=|^entrypoint\s*=|^import_map\s*=' supabase/config.toml
```

MCP follow-ups, approved session only:

```text
supabase_get_logs(service="edge-function")
supabase_get_advisors(type="security")
supabase_get_advisors(type="performance")
```

## Redaction Rules

- Do not persist bearer tokens, service-role keys, provider secrets, Vault plaintext, DB passwords, raw request bodies, raw response payloads, raw webhook payloads, raw PII, raw log IDs, raw function UUIDs, raw project refs, or secret-derived values.
- Summarize logs by function slug, deployed version when available, status class, safe error category, and whether the signal is on the current or older deployment version.
- For advisors, persist advisor name, severity, sanitized schema/table/function/index identifier, and remediation URL only. Do not copy raw SQL data, row samples, or project identifiers.
- For Auth leaked password protection, record an owner decision or dashboard screenshot summary without user lists, passwords, tokens, or project secrets.

## Follow-up Acceptance Checks

- Current-version edge logs have no unexplained recurring `integration-config` or `cleanup-orphan-storage` `500` signals; if present, add a local regression before changing source.
- `midtrans-webhook` `400` log samples are classified into safe request categories such as invalid JSON or missing required fields without storing payload fields.
- Security advisors are rechecked after any future RPC grant change; the `claim_profile_push_token` warning is accepted only while the direct signed-in customer registration contract remains active.
- Performance advisors are reviewed against `supabase/INDEX_REVIEW_DECISIONS.md`; no index is dropped solely because it is labeled `unused_index`.
- `create-checkout-order` deployment provenance is confirmed during the next safe release window or normalized by an approved redeploy.
