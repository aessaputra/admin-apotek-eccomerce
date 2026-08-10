# Product Expiry Visual Indicator & Tag Refinement Specification

## Overview
This specification refines the visual display of product expiry dates across the Admin Panel product pages (`ProductList`, `ProductCard`, and `ProductShow`). 

The goal is to eliminate unnecessary visual noise (such as "Aman" or "Mendekati ED" tag pills in table lists and cards) while using color-coded date text for immediate visual hierarchy. Full status tags will be reserved exclusively for the Product Detail page (`ProductShow`).

---

## Behavior & Design Contracts

### 1. Product List Table (`list.tsx`) & Mobile Card View (`ProductCard.tsx`)
In table rows and mobile card views:
- **No Tag Pills**: Neither "Mendekati ED", "Kedaluwarsa", nor "Aman" tag pills are displayed.
- **Color-Coded Expiry Date Text**:
  - **Kedaluwarsa (Expired, ED ≤ Today)**: Text rendered in **Red** (`type="danger"`, e.g. `01 Jul 2026`).
  - **Mendekati ED (Near Expiry, ED ≤ 30 Days & not expired)**: Text rendered in **Amber / Orange** (`colorWarning`, `#d48806`, e.g. `15 Agu 2026`).
  - **Aman (Safe, ED > 30 Days)**: Text rendered in **Standard Secondary Gray** (`type="secondary"`, e.g. `01 Des 2026`).
- **Date Formatting**: All dates rendered as `DD MMM YYYY` (formatted via `dayjs`).

### 2. Product Detail Page (`ProductShow` / `show.tsx`)
In the product detail page:
- **Kedaluwarsa**: Displays Red status tag `<Tag color="error">Kedaluwarsa</Tag>` alongside the formatted expiry date in red.
- **Mendekati ED**: Displays Orange status tag `<Tag color="warning">Mendekati ED</Tag>` alongside the formatted expiry date in amber/orange.
- **Aman**: Displays the formatted expiry date in standard text without any status tag.

### 3. Locale & UX Copy Refinement
- Update locale keys in `src/locales/id/common.json` and `src/locales/en/common.json` to keep copy clean and concise:
  - `products.expiryStatus.nearExpiry`: `"Mendekati ED"` (ID) / `"Near Expiry"` (EN).

---

## Affected Files
1. `src/locales/id/common.json` & `src/locales/en/common.json`
2. `src/pages/products/list.tsx`
3. `src/pages/products/components/ProductCard.tsx`
4. `src/pages/products/show.tsx`
5. `src/pages/products/components/__tests__/ProductCard.test.tsx`
6. `src/pages/__tests__/lists.test.tsx`
7. `src/pages/__tests__/details.test.tsx`

---

## Verification Plan
1. Unit tests:
   - `pnpm vitest run src/pages/products/components/__tests__/ProductCard.test.tsx`
   - `pnpm vitest run src/pages/__tests__/lists.test.tsx`
   - `pnpm vitest run src/pages/__tests__/details.test.tsx`
2. Full test suite: `pnpm test`
3. Build check: `pnpm build`
