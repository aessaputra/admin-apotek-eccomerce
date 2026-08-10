# Dashboard Mobile Responsive Polish Design Spec

**Date:** 2026-08-09  
**Status:** Approved  
**Scope:** Admin Panel Dashboard (`src/pages/dashboard/`)  
**Technologies:** React 19, Refine.dev v5, Ant Design v5  

---

## 1. Overview

The Admin Panel Dashboard currently implements a responsive grid layout using Ant Design's `Row` and `Col` breakpoid system (`xs`, `sm`, `md`, `xl`), along with horizontal scroll support for tables and `autoFit` line charts.

This design document specifies the mobile UI polish (Approach 1) to enhance the user experience on mobile viewports (< 576px down to 360px), specifically focusing on:
1. Transforming the Operational Trend Granularity Selector into a responsive, equal-width segmented flex control on mobile screens.
2. Optimizing KPI Statistic card padding and touch targets adaptively using Ant Design design tokens.
3. Enhancing table, alert, and list layouts for mobile screens without horizontal overflow or awkward wrapping.

---

## 2. Goals & Requirements

### 2.1 Functional Requirements
- **Granularity Control**: On mobile viewports (`xs < 576px`), the trend granularity selector ("Hari", "Minggu", "Bulan", "Tahun") must span full container width (`width: 100%`) with items evenly distributed (`flex: 1`, `text-align: center`). On desktop (`md+`), it must remain aligned to the right.
- **Card Padding & Touch Spacing**: Use adaptive Ant Design design tokens (`token.paddingSM` on mobile `xs`, `token.padding` on `md+`) to maximize vertical space efficiency while preserving a minimum touch target size of 44px for interactive elements.
- **Data Integrity**: Preserve all Refine data providers, query stale times (60,000ms), error boundaries, retry handlers, and backend RPC metric contracts (`admin_operational_metrics`).
- **Accessibility (A11y)**: Maintain all existing screen reader table summaries (`visuallyHiddenStyle`), `aria-label`, and `aria-describedby` associations.

---

## 3. Architecture & Component Changes

### 3.1 `src/pages/dashboard/MonthlyOperationalTrendCard.tsx` & `styles.ts`
- Update header container layout for `MonthlyOperationalTrendCard`:
  - Split header into a stacked layout on `xs`: title on top, granularity filter taking full width below it.
  - Apply responsive flex styling for `Radio.Group` / `Segmented` control:
    - Mobile (`xs`): `display: flex`, `width: 100%`, with option items having `flex: 1` and centered text alignment.
    - Desktop (`md+`): `display: flex`, `justifyContent: flex-end`, standard item widths.

### 3.2 `src/pages/dashboard/styles.ts` & `index.tsx`
- Add responsive helper styles for KPI card padding and mobile touch targets.
- Ensure KPI statistic values remain legible across small screens without text wrapping.
- Update `List.Item` in Low Stock Alerts and `Table` in Recent Orders to maintain consistent touch feedback padding (`token.paddingSM`).

---

## 4. Accessibility & Data Flow

- **Accessibility**: Standard WCAG 2.1 AA compliance across light and dark themes. Ensure focus ring states and minimum 44px touch targets.
- **Data Flow**: Unchanged. `useList` hooks for `orders`, `products`, and `admin_operational_metrics` continue operating through existing data provider adapters.

---

## 5. Verification Plan

1. **Unit & Integration Tests**:
   - Run `pnpm vitest run src/pages/dashboard` to verify all KPI models, alert filters, and trend data mappers pass without regressions.
2. **TypeScript & Build Check**:
   - Run `pnpm build` to confirm zero type errors or bundle issues.
3. **Responsive Visual Audit**:
   - Verify layout rendering on mobile breakpoints (320px, 375px, 576px), tablet (768px), and desktop (1200px+).
