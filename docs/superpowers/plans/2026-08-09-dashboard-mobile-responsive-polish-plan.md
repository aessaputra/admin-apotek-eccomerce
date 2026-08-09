# Plan: Dashboard Mobile Responsive Polish

Implementation plan for polishing mobile responsiveness across the Admin Panel Dashboard (`src/pages/dashboard/`), implementing Approach 1 based on spec [`docs/superpowers/specs/2026-08-09-dashboard-mobile-responsive-polish-design.md`](file:///home/coder/dev/pharma/admin-panel/docs/superpowers/specs/2026-08-09-dashboard-mobile-responsive-polish-design.md).

## Approach

Refactor the trend granularity selector in `MonthlyOperationalTrendCard.tsx` to use responsive flex layout styling (`width: 100%`, `display: flex`, equal item width on `xs < 576px`), and update KPI / alert card padding dynamically via Ant Design design tokens in `styles.ts` and `index.tsx`.

## Scope

- **In**:
  - `src/pages/dashboard/styles.ts`: Add responsive layout helper functions and flex styles for mobile trend granularity selector and compact card padding.
  - `src/pages/dashboard/MonthlyOperationalTrendCard.tsx`: Update header layout and apply mobile responsive flex styles to `Radio.Group`.
  - `src/pages/dashboard/index.tsx`: Apply responsive padding tokens to KPI cards and alert containers.
  - Automated tests: Run existing Vitest tests and verify build.
- **Out**:
  - Schema, backend Edge Functions, RPC metrics, or non-dashboard page changes.

## Action Items

- [ ] **Step 1: Add responsive helper styles**  
  Update `src/pages/dashboard/styles.ts` to export flex layout helpers for mobile granularity selector (`width: 100%`, equal-width items) and responsive card padding tokens (`token.paddingSM` on mobile).

- [ ] **Step 2: Update Trend Card header and Granularity Selector**  
  Refactor header layout in `src/pages/dashboard/MonthlyOperationalTrendCard.tsx` so `Radio.Group` stretches neatly across full width on `xs` viewports (< 576px) and aligns right on `md+`.

- [ ] **Step 3: Apply responsive padding to KPI and Alert Cards**  
  Update `src/pages/dashboard/index.tsx` to consume responsive padding styles for primary/secondary KPI cards, Recent Orders table, Low Stock list, and Near Expiry alert card.

- [ ] **Step 4: Run test suite**  
  Execute `pnpm vitest run src/pages/dashboard` to ensure all KPI calculations, alert filters, and trend mappings pass cleanly.

- [ ] **Step 5: Run build verification**  
  Execute `pnpm build` to verify TypeScript strict check and Vite bundling succeed without errors.

- [ ] **Step 6: Commit changes**  
  Stage and commit the implemented changes with a conventional commit message.

## Validation

- `pnpm vitest run src/pages/dashboard` passes with 0 errors.
- `pnpm build` completes cleanly.
