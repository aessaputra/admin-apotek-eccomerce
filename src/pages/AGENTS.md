# Pages Module

**Purpose:** Refine route/page implementations for admin resources, reports, auth, dashboard, profile, and settings/runtime-config flows.

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
├── reports/              # sales report read-model page and PDF export
├── settings/             # singleton settings + runtime config; see settings/AGENTS.md
├── profile/              # current admin profile/MFA settings
└── __tests__/            # broad page smoke/behavior tests
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Register page/resource route | `src/App.tsx` | Add lazy import, resource, and `<Route>` together |
| Standard list pattern | `products/list.tsx`, `categories/list.tsx` | `List` + `useTable` + AntD `Table` |
| Standard form pattern | `categories/create.tsx`, `products/edit.tsx` | `Create`/`Edit` + `useForm` + AntD `Form` |
| Dashboard trend logic | `dashboard/monthlyOperationalTrends.ts`, `dashboard/dashboardKpis.ts` | Pure date/zero-fill/KPI helpers; test directly |
| Order admin action | `orders/show.tsx` | High-risk frontend counterpart to `order-manager` Edge Function |
| Customer ban action | `customers/`, `src/hooks/useBanToggle.ts` | Calls `ban-customer`, not direct table mutation |
| Settings/runtime config | `settings/` | Singleton settings plus integration-config Edge Function gateway |
| Report/PDF export | `reports/sales.tsx`, `reports/sales-pdf-export.ts` | Uses report read resources plus export RPC |
| Home banner behavior | `home-banners/` + `specs/home-banner.md` | Respect media prefix, CTA route, placement constraints |
| Auth/MFA UI | `auth/`, `profile/` | Must match provider state in `src/providers/auth.ts` and `src/utils/mfa.ts` |

## RESOURCE / READ MODEL RULES

- `src/App.tsx` is the source of truth for visible resources and backing report resources.
- `orders` uses `meta.readResource = ORDER_READ_RESOURCE` and provider mapping to `order_read_model`.
- `products` reads route through `admin_products` in `src/providers/data.ts` for admin SKU/image shape.
- Reports use backing resources: `report_daily_sales`, `report_product_sales`, `report_sold_products`, `report_customer_sales`.
- `settings`, `profile`, and `auth` are singleton/custom flows, not normal CRUD resources.

## CONVENTIONS

- Page folders mirror Refine resources; standard CRUD filenames are `list.tsx`, `create.tsx`, `edit.tsx`, `show.tsx`.
- Use `useTranslation()` from Refine/i18n and add keys to both `src/locales/id/common.json` and `src/locales/en/common.json`.
- Keep resource names aligned with `src/App.tsx`; reports may use backing read resources rather than visible route names.
- Prefer pure helpers next to complex pages and test them independently, as done in dashboard and sales report helpers.
- Page tests live in `src/pages/__tests__/` or the page subfolder `__tests__/` for auth/profile/dashboard/reports.
- Large shared page tests (`forms.test.tsx`, `lists.test.tsx`, `order-show.test.tsx`) cover multiple resources; update them when changing shared form/list/order behavior.

## HOTSPOTS

- `orders/show.tsx`: order activities, status/payment/shipping actions, manual waybill override, `order-manager` invocation.
- `settings/`: Biteship origin/courier config, Midtrans runtime config, technical config, branding upload.
- `reports/sales.tsx`: report resources, date filters, PDF export, localized filenames/sections.
- `profile/index.tsx`: password update and Supabase MFA factor lifecycle.

## ANTI-PATTERNS

- **NEVER** call Supabase service-role APIs from pages.
- **NEVER** bypass provider/resource abstractions for privileged admin data unless the page calls a vetted Edge Function/RPC.
- **NEVER** add a visible resource without route/resource/i18n/test coverage.
- **NEVER** duplicate order/payment status mapping in page code; use constants/shared helpers.
- **NEVER** change `orders/show.tsx` status/shipping actions without checking `supabase/functions/order-manager/` and order-show tests.
- **NEVER** expose runtime config secrets in settings panels; show masked metadata and rotate through `integration-config`.
