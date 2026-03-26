# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-26
**Commit:** 1387785
**Branch:** main

## OVERVIEW

Pharmacy e-commerce admin panel built with **Refine v5** (React framework for data-intensive apps) + **Ant Design v5** + **Supabase** (BaaS). Manages products, categories, orders, customers with Midtrans payment and Biteship shipping integrations via Supabase Edge Functions (Deno runtime).

## STRUCTURE

```
/
├── src/
│   ├── App.tsx              # Refine app config, routing, resources
│   ├── index.tsx            # Entry point (React 19 + AntD patch)
│   ├── i18n.ts              # i18next config (id/en locales)
│   ├── components/          # UI components (header, uploads, layout)
│   ├── constants/           # Order status/payment colors/labels
│   ├── contexts/            # Color mode context
│   ├── hooks/               # useSupabaseUpload, useBanToggle
│   ├── locales/             # i18n JSON (id/common.json, en/common.json)
│   ├── pages/               # CRUD pages per resource (products, orders, etc.)
│   ├── providers/           # Auth, data, Supabase client (SEE: src/providers/AGENTS.md)
│   └── utils/               # slugify, storage, functions-error
├── supabase/
│   ├── functions/           # Edge Functions (Deno)
│   │   ├── _shared/         # Shared utilities (SEE: supabase/functions/_shared/AGENTS.md)
│   │   ├── biteship/        # Shipping tracking API
│   │   ├── create-snap-token/ # Midtrans Snap token
│   │   ├── midtrans-webhook/  # Payment webhook
│   │   └── order-manager/   # Order status management
│   └── migrations/          # SQL migrations
├── .agents/                 # AI agent skill definitions
├── package.json             # pnpm@10.30.3, React 19, Refine v5
├── vite.config.ts           # Build with manual chunks (vendor/antd/refine/i18n)
└── tsconfig.json            # Strict mode, ES2020 target
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new CRUD resource | `src/pages/{resource}/` + `src/App.tsx` resources array | Follow Refine convention: list/create/edit/show |
| Modify auth flow | `src/providers/auth.ts` | Supabase auth, admin role check |
| Change data fetching | `src/providers/data.ts` | Custom delete handlers for storage cleanup |
| Add i18n key | `src/locales/{id,en}/common.json` | useTranslation() hook |
| Modify shipping | `supabase/functions/biteship/index.ts` | Deno Edge Function |
| Modify payments | `supabase/functions/midtrans-webhook/index.ts` | Payment status handling |
| Add Edge Function | `supabase/functions/{name}/index.ts` | Deno runtime, use `_shared/` for utilities |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `App` | Component | `src/App.tsx:59` | Main Refine app, routing, resources |
| `authProvider` | Provider | `src/providers/auth.ts:48` | Supabase auth, admin-only access |
| `dataProvider` | Provider | `src/providers/data.ts:27` | Supabase data + delete cleanup hooks |
| `useSupabaseUpload` | Hook | `src/hooks/useSupabaseUpload.ts:28` | Reusable upload logic for storage buckets |
| `i18nProvider` | Provider | `src/App.tsx:62` | Custom i18n wrapper for Refine |

## CONVENTIONS

### Refine Pattern
- Resources defined in `<Refine resources={[...]}/>` array
- Pages follow CRUD: `{resource}/list.tsx`, `create.tsx`, `edit.tsx`, `show.tsx`
- Use `useTable`, `useForm`, `useShow` hooks from `@refinedev/antd`

### Routing
- `BrowserRouter` + Refine's `routerProvider` work together
- Protected routes wrapped in `<Authenticated>` component
- Auth fallback: `/login` page

### TypeScript
- Strict mode enabled (`strict: true`)
- `noUnusedParameters: true`, `noUnusedLocals: false`
- Type assertions via interfaces, NOT `as any`

### Testing
- Vitest with `globals: true` (no imports needed)
- Tests co-located in `__tests__/` directories
- Run: `pnpm test`

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** expose `SUPABASE_SERVICE_ROLE_KEY` or Midtrans Server Key in client code
- **NEVER** commit `.env` or secrets - use `.env.example` template
- **NEVER** bypass auth provider - all routes require authentication
- **NO CI/CD** - No GitHub Actions, manual deploys required
- **NO E2E tests** - Only unit tests in `src/utils/__tests__/`

## UNIQUE STYLES

### Admin-Only Auth (src/providers/auth.ts)
Login fails for non-admin users. Role checked via `profiles.role === 'admin'`. Registration disabled.

### Storage Cleanup on Delete (src/providers/data.ts)
Deleting categories/products auto-removes storage bucket files (logos/images) via custom `deleteOne`/`deleteMany` handlers.

### Edge Functions (Deno)
Backend runs on Deno runtime in Supabase Edge Functions. Use `.npmrc` for npm package compatibility. Shared code in `_shared/` directory.

### i18n as Refine Provider
Custom `i18nProvider` wraps react-i18next. Translate via `t(key, defaultMessage, options)` - defaultMessage required for fallback.

## COMMANDS

```bash
pnpm dev      # Start dev server (refine dev)
pnpm build    # TypeScript check + production build
pnpm start    # Production server (refine start)
pnpm test     # Run Vitest tests
```

## NOTES

1. **React 19 + Ant Design**: Uses `@ant-design/v5-patch-for-react-19` compatibility patch
2. **Manual chunks**: Vite splits into vendor/antd/refine/i18n for optimal loading
3. **Supabase migrations**: In `supabase/migrations/` - follow timestamp naming
4. **`.temp/`**: Supabase CLI temp files - should be in `.gitignore`
5. **No health checks**: Dockerfile lacks HEALTHCHECK directive