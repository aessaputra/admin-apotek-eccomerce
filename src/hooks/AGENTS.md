# Hooks Module

**Purpose:** Shared React hooks for Supabase uploads, Biteship courier loading, customer ban actions, product SKU fields, and store branding.

## FILES

| File | Role |
|------|------|
| `useSupabaseUpload.ts` | Validates/uploads/removes media and returns AntD Upload handlers |
| `useBiteshipCouriers.ts` | Fetches courier services through the Biteship Edge Function with static fallback |
| `useBanToggle.ts` | Calls `ban-customer` Edge Function for customer status changes |
| `useProductSkuField.ts` | Product SKU form normalization/generation/duplicate behavior |
| `useStoreBranding.ts` | Store branding React Query hook and cache key |
| `__tests__/` | Hook tests with renderHook, async waits, Supabase/fetch mocks |

## UPLOAD LIFECYCLE

- `useSupabaseUpload` validates image type/size through `src/utils/storage.ts` before upload.
- Saved form values are canonical storage paths; public URLs are only for display/upload responses.
- `replaceOnUpload` deletes the previous single-file value before saving the new path.
- `includeUserId` prefixes avatar object names with `${user.id}-` for avatar RLS compatibility.
- `handleRemove` accepts stored paths or public URLs, extracts safe storage paths, removes storage objects, then updates form state.
- Product image arrays append paths; category/avatar/settings/banner single values replace.

## BITESHIP / PRIVILEGED CALLS

- Browser code never calls Biteship directly; `useBiteshipCouriers` POSTs `{ action: "couriers" }` to `functions/v1/biteship` with the current Supabase access token.
- Missing token, failed response, invalid rows, or network errors fall back to `BITESHIP_FALLBACK_COURIER_SERVICES`.
- Shipping settings treats fallback courier data as read-only.
- `useBanToggle` calls `ban-customer`, then invalidates Refine `profiles` list/detail caches.

## CONVENTIONS

- Hook files are flat under `src/hooks`; do not create deep hook subtrees unless a feature becomes large.
- Tests live in `src/hooks/__tests__/` and use `@testing-library/react` `renderHook` / `waitFor`.
- React Query hook tests provide a local `QueryClientProvider` with retries disabled.
- Mock Supabase via module mocks or injected behavior; avoid real network/storage calls.
- Edge Function hooks normalize user-facing error messages through existing utility patterns.
- Keep fallback data deterministic so tests and offline admin screens remain stable.
- Update related page/component tests when hook return shapes or fallback behavior changes.

## ANTI-PATTERNS

- **NEVER** read service-role secrets from hooks.
- **NEVER** skip media path validation before upload/delete calls.
- **NEVER** make hooks depend on mutable module globals that cannot be reset in Vitest.
- **NEVER** hide failed privileged mutations; surface safe messages to the caller.
- **NEVER** save Biteship fallback courier rows as if they were verified live config.
