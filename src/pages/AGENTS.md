# Pages Module

**Purpose:** Refine route/page implementations for admin resources, reports, auth, dashboard, and profile flows.

## STRUCTURE

```text
src/pages/
├── auth/                 # login, forgot/reset password, MFA verify
├── dashboard/            # metrics cards and operational trend helpers
├── products/             # product CRUD with images/SKU handling
├── categories/           # category CRUD with logo upload
├── orders/               # order list/show/actions against read model
├── customers/            # profile/customer admin views and ban actions
├── home-banners/         # banner CRUD and media library integration
├── reports/              # sales report read-model page
├── settings/             # store settings and origin/courier config
├── profile/              # current admin profile/MFA settings
└── __tests__/            # broad page smoke/behavior tests
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Register page/resource route | `src/App.tsx` | Add resource and `<Route>` together |
| List page pattern | `products/list.tsx`, `categories/list.tsx` | `List` + `useTable` + AntD `Table` |
| Form page pattern | `categories/create.tsx`, `products/edit.tsx` | `Create`/`Edit` + `useForm` + AntD `Form` |
| Dashboard trend logic | `dashboard/monthlyOperationalTrends.ts` | Pure date/zero-fill helpers; test directly |
| Order admin action | `orders/show.tsx` | High-risk frontend counterpart to `order-manager` Edge Function |
| Profile/MFA flow | `profile/index.tsx`, `auth/mfa-verify.tsx` | Keep in sync with `src/providers/auth.ts` pending MFA state |
| Home banner behavior | `home-banners/` + `specs/home-banner.md` | Respect media prefix and CTA route constraints |
| Auth/MFA UI | `auth/`, `profile/` | Must match provider state in `src/providers/auth.ts` |

## CONVENTIONS

- Page folders mirror Refine resources; standard CRUD filenames are `list.tsx`, `create.tsx`, `edit.tsx`, `show.tsx`.
- Use `useTranslation()` from Refine/i18n and add keys to both `src/locales/id/common.json` and `src/locales/en/common.json`.
- Keep resource names aligned with `src/App.tsx`; reports may use backing read resources rather than visible route names.
- Prefer pure helpers next to complex pages and test them independently, as done in dashboard trend helpers.
- Page tests live in `src/pages/__tests__/` or the page subfolder `__tests__/` for auth/profile/dashboard.
- Large shared page tests (`forms.test.tsx`, `lists.test.tsx`, `order-show.test.tsx`) cover multiple resources; update them when changing shared form/list/order behavior.

## ANTI-PATTERNS

- **NEVER** call Supabase service-role APIs from pages.
- **NEVER** bypass provider/resource abstractions for privileged admin data unless the page calls a vetted Edge Function/RPC.
- **NEVER** add a visible resource without route/resource/i18n/test coverage.
- **NEVER** duplicate order/payment status mapping in page code; use constants/shared helpers.
- **NEVER** change `orders/show.tsx` status/shipping actions without checking `supabase/functions/order-manager/` and order-show tests.
