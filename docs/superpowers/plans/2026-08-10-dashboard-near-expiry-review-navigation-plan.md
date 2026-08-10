# Implementation Plan: Dashboard Near Expiry Review Navigation

**Spec Document:** [`docs/superpowers/specs/2026-08-10-dashboard-near-expiry-review-navigation-design.md`](file:///home/coder/dev/pharma/admin-panel/docs/superpowers/specs/2026-08-10-dashboard-near-expiry-review-navigation-design.md)

---

## 1. Approach

Update the Dashboard Near Expiry alert card ("Tinjau" button and header arrow button) in `src/pages/dashboard/index.tsx` to navigate to `/products` with Refine `syncWithLocation` URL filter query parameters (`pageSize=10`, `currentPage=1`, `sorters[0][field]=created_at`, `filters[0][field]=expiry_date&filters[0][operator]=gt`, `filters[1][field]=expiry_date&filters[1][operator]=lte`).  
Update `src/pages/products/list.tsx` to synchronize its initial Expiry Status UI select dropdown (`expiryStatus`) when mounted with URL filter parameters.

---

## 2. Scope

- **In:**
  - Dynamic `todayStr` and `thirtyDaysStr` URL construction in `src/pages/dashboard/index.tsx`.
  - Wire "Tinjau" button and header arrow icon to navigate to the exact Refine filter query string URL.
  - Parse initial URL filters in `src/pages/products/list.tsx` to set `expiryStatus` UI dropdown to `"nearExpiry"`.
  - Unit test coverage in `src/pages/__tests__/dashboard.test.tsx` and `src/pages/__tests__/lists.test.tsx`.
- **Out:**
  - Schema or migration changes.
  - Modifying non-expiry alert cards.

---

## 3. Action Items

- [ ] **Task 1: Update Dashboard Navigation in `src/pages/dashboard/index.tsx`**
  - Construct `nearExpiryReviewUrl` with `todayStr` (`YYYY-MM-DD`) and `thirtyDaysStr` (`YYYY-MM-DD`).
  - Wire button onClick events to navigate using `go({ to: nearExpiryReviewUrl })` or `navigate(nearExpiryReviewUrl)`.

- [ ] **Task 2: Update Product List Filter Sync in `src/pages/products/list.tsx`**
  - Read initial `filters` from `useTable` / `location.search` on mount.
  - Initialize `expiryStatus` state to `"nearExpiry"` if `expiry_date` filters (`gt` and `lte`) are detected.

- [ ] **Task 3: Update Dashboard Navigation Tests in `src/pages/__tests__/dashboard.test.tsx`**
  - Add test asserting navigation to `/products` with the exact query string parameters when "Tinjau" or the arrow header button is clicked.

- [ ] **Task 4: Update Product List Filter Sync Tests in `src/pages/__tests__/lists.test.tsx`**
  - Add test asserting `ProductList` initializes the Expiry Status UI select dropdown to "nearExpiry" when mounted with URL filter parameters.

- [ ] **Task 5: Verification & Quality Assurance**
  - Run `pnpm test` to verify all test suites pass.
  - Run `pnpm build` to verify type checking and Vite build succeed.
