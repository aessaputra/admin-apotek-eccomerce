# Specification: Orders Page Responsive Design & Mobile Optimization

**Date:** 2026-08-09  
**Status:** Approved  
**Target Module:** Admin Panel Orders Resource (`src/pages/orders/`)  

---

## 1. Overview & Objectives

This specification outlines the responsive design enhancement for the Orders module in the Pharmacy Admin Panel (`admin-panel`). The primary objective is to provide a seamless mobile and tablet experience for pharmacy admins processing orders on mobile devices while maintaining power-user productivity on desktop displays.

### Goals
1. **Hybrid Mobile View for `OrderList` (`list.tsx`)**: Render an intuitive Card List View on mobile screens (`< 576px`) and retain the rich feature-set of Ant Design Table on Tablet/Desktop (`>= 576px`).
2. **Scrollable Mobile Quick Filters**: Transform the order status quick filter bar into a touch-friendly, horizontal scrollable pill bar on mobile devices to prevent excessive vertical height consumption.
3. **Mobile Layout Reordering for `OrderShow` (`show.tsx`)**: Prioritize immediate administrative action on mobile by placing Order Summary & `OrderActionForm` at the top of the mobile viewport, followed by Order Details, Product List, and Activity Logs.
4. **Touch-Optimized Form Actions (`OrderActionForm.tsx`)**: Ensure full-width touch targets (minimum 44px height) and vertical stacked field spacing on mobile screens.

---

## 2. Architecture & Component Breakpoints

We leverage Ant Design's `Grid.useBreakpoint()` hook combined with Refine v5 hooks (`useTable`, `useShow`, `useTranslation`) to determine device viewports dynamically.

### Breakpoint Matrix

| Viewport | Width | Layout Mode (`OrderList`) | Column Structure (`OrderShow`) |
|---|---|---|---|
| **Mobile (`xs`)** | `< 576px` | Card List View + Scrollable Filter Pills | Single column, prioritized: Order Summary -> Action Form -> Details -> Products -> Activities |
| **Tablet (`sm`, `md`)** | `576px - 991px` | Full AntD Table (`scroll={{ x: "max-content" }}`) | Stacked 2-column or full width |
| **Desktop (`lg`, `xl`, `xxl`)** | `>= 992px` | Full AntD Table with all columns visible | Side-by-side 2-column grid (`Col lg={16}` & `Col lg={8}`) |

---

## 3. Detailed Component Designs

### 3.1. `OrderList` (`src/pages/orders/list.tsx`)

#### Mobile Card List View (`< 576px`)
- When `screens.xs && !screens.sm`, the component renders `<List>` containing `<Card>` components.
- Each Card contains:
  - **Header**: Order ID (copyable text & clickable link to `/orders/show/:id`) + Order Status Tag (using `STATUS_COLORS`).
  - **Body Grid**: Total Amount formatted in IDR currency, Payment Status Tag (`PAYMENT_COLORS`), Courier label & Waybill badge, and Creation Date.
  - **Footer Action**: Full-width primary/default button `"Lihat Detail"` pointing to the detail page.

#### Tablet & Desktop View (`>= 576px`)
- Renders standard `<Table>` with `scroll={{ x: "max-content" }}`.
- Column visibility props:
  - `id`: Always visible (`width={80}`).
  - `total_amount`: Responsive `["sm"]`.
  - `status`: Always visible (with status filter dropdown).
  - `payment_status`: Always visible (with payment filter dropdown).
  - `payment_type`: Responsive `["lg"]`.
  - `courier_code`: Responsive `["md"]`.
  - `waybill_number`: Responsive `["md"]`.
  - `created_at`: Responsive `["lg"]`.
  - `actions`: Always visible.

#### Touch-Friendly Quick Filters Bar
- Quick filters wrapper receives CSS styles:
  ```css
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  gap: 8px;
  padding-bottom: 8px;
  -webkit-overflow-scrolling: touch;
  ```
- Prevents multi-line wrapping on narrow viewports.

---

### 3.2. `OrderShow` (`src/pages/orders/show.tsx`)

#### Responsive Layout Ordering
Using Ant Design `<Row>` and `<Col>` with responsive flex direction:
- On Desktop (`>= 992px`):
  - Left Col (`xs={24} lg={16}`): Product Table Collapse -> Order Details Cards -> Activity Collapse.
  - Right Col (`xs={24} lg={8}`): Order Summary Collapse -> Order Action Form Collapse.
- On Mobile (`< 992px`):
  - Flex direction reversed / reordered to present Order Summary & Order Action Form at the top.

---

### 3.3. Subcomponent Optimizations

#### `OrderActionForm.tsx`
- Form controls (Select dropdowns, Input text, Action buttons) adjust to `width: 100%` on mobile screens.
- Touch target height set to at least 40px–44px for easy mobile usage.

#### `OrderDetailsCards.tsx`
- Grid columns adjust dynamically via CSS Grid:
  ```css
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  ```
- Long text items (Addresses, Waybill numbers) use `overflow-wrap: break-word` to avoid layout breaks on narrow screens.

---

## 4. Error Handling & Data Flow

- Retain existing Refine `useTable` and `useShow` state management.
- If data fails to fetch or edge functions fail during status update, display standard AntD `<Alert type="error" showIcon />`.
- All i18n labels use key fallbacks through `useTranslation()`.

---

## 5. Verification Plan

1. **Automated Unit & Integration Tests**:
   - Run `pnpm test` / `pnpm vitest run src/pages/orders` to ensure existing tests pass cleanly.
2. **Build Validation**:
   - Run `pnpm build` to verify clean TypeScript compilation and bundling.
