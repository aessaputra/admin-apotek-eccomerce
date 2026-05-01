# Hooks Module

**Purpose:** Shared React hooks for Supabase uploads, Biteship courier loading, customer ban actions, product SKU fields, and store branding.

## FILES

| File | Role |
|------|------|
| `useSupabaseUpload.ts` | Validates/uploads/removes media and returns AntD Upload handlers |
| `useBiteshipCouriers.ts` | Fetches courier services with static fallback behavior |
| `useBanToggle.ts` | Calls `ban-customer` Edge Function for customer status changes |
| `useProductSkuField.ts` | Product SKU form normalization/generation behavior |
| `useStoreBranding.ts` | Store branding query and cache key |
| `__tests__/` | Hook tests with renderHook, async waits, Supabase/fetch mocks |

## CONVENTIONS

- Hook files are flat under `src/hooks`; do not create deep hook subtrees unless a feature becomes large.
- Tests live in `src/hooks/__tests__/` and use `@testing-library/react` `renderHook` / `waitFor`.
- Mock Supabase via module mocks or injected behavior; avoid real network/storage calls.
- For hooks that call Edge Functions, normalize user-facing error messages through existing utility patterns.
- Keep fallback data deterministic so tests and offline admin screens remain stable.
- Update related page/component tests when hook return shapes or fallback behavior changes.

## ANTI-PATTERNS

- **NEVER** read service-role secrets from hooks.
- **NEVER** skip media path validation before upload/delete calls.
- **NEVER** make hooks depend on mutable module globals that cannot be reset in Vitest.
- **NEVER** hide failed privileged mutations; surface safe messages to the caller.
