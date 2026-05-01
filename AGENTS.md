# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-01
**Commit:** 801841c
**Branch:** dev

## OVERVIEW

Pharmacy e-commerce admin panel built with React 19, Refine v5, Ant Design v5, Vite, and Supabase. The repo colocates a browser admin app with Supabase Postgres migrations and Deno Edge Functions for Midtrans payments, Biteship shipping, push notifications, checkout, and storage reconciliation.

## STRUCTURE

```text
/
├── src/
│   ├── App.tsx                 # Refine resources, routes, providers
│   ├── index.tsx               # React 19 + AntD patch bootstrap
│   ├── providers/              # Auth/data/Supabase client; see src/providers/AGENTS.md
│   ├── pages/                  # Refine pages/resources; see src/pages/AGENTS.md
│   ├── components/             # AntD UI, uploads, maps; see src/components/AGENTS.md
│   ├── hooks/                  # Upload, branding, ban, Biteship; see src/hooks/AGENTS.md
│   ├── constants/              # Resource/status/courier/banner constants
│   ├── utils/                  # Pure helpers and frontend storage/function errors
│   └── locales/                # id/en i18next common namespace
├── supabase/
│   ├── AGENTS.md               # Backend-wide Supabase rules
│   ├── config.toml             # Local CLI/runtime/function JWT config
│   ├── functions/              # Edge Functions; see supabase/functions/AGENTS.md
│   └── migrations/             # SQL history; see supabase/migrations/AGENTS.md
├── specs/                      # Product/operation specs
├── Dockerfile                  # Static build container; note lockfile caveat below
├── package.json                # pnpm@10.30.3 scripts and deps
├── vite.config.ts              # Manual chunks: vendor/antd/refine/i18n
└── vitest.config.ts            # jsdom, globals, setup file
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add/change Refine resource | `src/App.tsx` + `src/pages/{resource}/` | Resources/routes stay centralized in `App.tsx` |
| Change auth/admin/MFA behavior | `src/providers/auth.ts` | Admin role is `profiles.role === "admin"` |
| Change data reads/deletes | `src/providers/data.ts` | Maps read models, RPC metrics, media cleanup |
| Add i18n label | `src/locales/{id,en}/common.json` | Default/fallback language is Indonesian (`id`) |
| Change uploads/media cleanup | `src/hooks/useSupabaseUpload.ts`, `src/utils/storage.ts`, `supabase/functions/cleanup-orphan-storage/` | Immediate UI cleanup plus backend dry-run reconciliation |
| Change payment/webhook flow | `supabase/functions/midtrans-webhook/`, `confirm-midtrans-payment/`, `reconcile-pending-midtrans-payments/`, `_shared/midtrans.ts` | Preserve signature verification and idempotency |
| Change checkout flow | `supabase/functions/create-checkout-order/`, `create-snap-token/`, checkout RPC migrations | Service-role RPC path; browser direct execute stays revoked |
| Change shipping/order ops | `supabase/functions/biteship/`, `order-manager/`, `_shared/biteship.ts` | Biteship API key only in Edge Function env |
| Change notifications | `src/components/header/notifications/`, `supabase/functions/push/`, notification migrations | Admin notifications and push delivery are separate paths |
| Change schema/RLS/cron | `supabase/migrations/` | New timestamped migration only; verify remote state |
| Change Maps/location UI | `src/components/map-location-picker/`, `src/pages/settings/` | Google Maps API key stays frontend publishable only |

## RELATED FRONTEND REPO

Customer-facing app lives at `/home/coder/dev/pharma/frontend` and is a separate Expo/React Native repo with its own root/nested `AGENTS.md`; read it before changing contracts consumed by customers. It uses npm/package-lock, Expo Router, Tamagui, Redux/Zustand/TanStack Query, Supabase public client/auth, realtime notifications, and Supabase Storage.

Cross-repo sensitive contracts include Supabase schema/RLS/generated types, `order_read_model`, checkout RPC/Edge Functions (`create-checkout-order`, `create-snap-token`, `confirm-midtrans-payment`, `confirm-order-received`), Midtrans payment statuses, Biteship rates/tracking payloads, order/customer bucket/status semantics, push notification types/routes, `profiles.role/is_banned/expo_push_token`, product/category/home-banner read models, and `media` bucket paths/prefixes. Do not assume shared code; coordinate contract changes explicitly and never copy backend secrets into the frontend repo.

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `App` | component | `src/App.tsx:64` | Refine providers, resources, routes, auth shell |
| `authProvider` | provider | `src/providers/auth.ts:71` | Supabase login, admin gate, MFA redirects |
| `dataProvider` | provider | `src/providers/data.ts:220` | Read-model mapping, RPC metrics, delete cleanup |
| `useSupabaseUpload` | hook | `src/hooks/useSupabaseUpload.ts:30` | Immediate media upload/remove behavior |
| `verifyMidtransSignature` | helper | `supabase/functions/_shared/midtrans.ts:163` | Webhook signature check |
| `buildSnapPayload` | helper | `supabase/functions/_shared/midtrans.ts:526` | Midtrans Snap request payload |
| `processWebhookSideEffectTask` | helper | `supabase/functions/_shared/webhook-side-effects.ts:513` | Async stock/cart/Biteship side effects |

## COMMANDS

```bash
pnpm dev       # refine dev server
pnpm build     # tsc && refine build
pnpm test      # vitest run
pnpm start     # refine start for built app
```

Supabase commands are documented in `supabase/AGENTS.md`. Use pnpm for repo scripts; `packageManager` pins `pnpm@10.30.3` even though `package-lock.json` is also present.

## CONVENTIONS

- TypeScript is strict; `noUnusedParameters` is enforced, `noUnusedLocals` is not.
- React 19 requires `@ant-design/v5-patch-for-react-19` imported before app render in `src/index.tsx`.
- Refine CRUD pages use `@refinedev/antd` hooks/components (`useTable`, `useForm`, `List`, `Create`, `Edit`, `Show`).
- Tests are Vitest files in `__tests__/` using `*.test.ts` or `*.test.tsx`; no E2E framework is configured.
- Frontend Supabase env vars are `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`; service-role keys never use `VITE_*`.
- Existing nested AGENTS files take precedence in their subtrees.

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** expose `SUPABASE_SERVICE_ROLE_KEY`, DB passwords, Vault secrets, Biteship API keys, or Midtrans Server Key in client code.
- **NEVER** commit `.env` or real secrets; `.env.example` is the only env template.
- **NEVER** bypass `authProvider.check` or the backend admin role checks.
- **NEVER** weaken Midtrans webhook signature/status verification or duplicate side effects.
- **NEVER** grant browser roles direct execute access to internal `SECURITY DEFINER` RPCs intended for `service_role`.
- Do not drop Supabase indexes only because an advisor labels them unused; check FK support, cron/admin paths, and replacement query shape first.

## UNIQUE STYLES

- `src/providers/data.ts` maps admin resources to protected read models and normalizes product/order records before Refine consumes them.
- `admin_operational_metrics` is fetched through RPC with strict filter extraction rather than a normal table list.
- Media lifecycle is split: UI deletes replaced/removed files immediately; `cleanup-orphan-storage` runs as cron/manual dry-run reconciliation with quarantine semantics.
- `midtrans-webhook`, `process-webhook-side-effects`, and reconciliation functions form one payment pipeline; review them together.
- Order lifecycle changes usually span `src/pages/orders/show.tsx`, `supabase/functions/order-manager/`, Midtrans helpers, Biteship helpers, and side-effect tests.
- Several Edge Functions have `verify_jwt = false` in Supabase config because they implement custom auth/signature/service-role validation internally.

## NOTES

1. No GitHub Actions workflows are present; verify locally with `pnpm build` and `pnpm test`.
2. Dockerfile currently checks `package-lock.json` before `pnpm-lock.yaml`, so container installs may diverge from pnpm unless fixed.
3. `supabase/functions/_shared` changes require redeploying every function that imports the changed helper.
4. Root `.env` exists locally; never read or print secrets unless explicitly required and safe.
5. Generated app README is generic; prefer this AGENTS hierarchy plus `supabase/AGENTS.md` for coding context.
