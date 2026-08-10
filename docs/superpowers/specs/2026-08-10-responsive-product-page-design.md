# Product Page Responsive Redesign Specification

**Date:** 2026-08-10  
**Status:** Approved  
**Target Modules:** `src/pages/products/` (`list.tsx`, `show.tsx`, `edit.tsx`, `create.tsx`) and new responsive component `src/pages/products/components/ProductCard.tsx`

---

## 1. Overview & Objectives

Transform the existing Pharmacy E-Commerce Admin Panel product pages (`ProductList`, `ProductShow`, `ProductEdit`, `ProductCreate`) into a fully modern, adaptive, and highly responsive interface for mobile, tablet, and desktop viewports.

### Key Goals:
- **Mobile First & Adaptive Hybrid Layout**: Seamlessly switch between a full-featured Ant Design Data Table on desktop (`≥768px`) and a sleek Product Card Grid View on mobile (`<768px`).
- **Enhanced Refine.dev Integration**: Leverage `@refinedev/antd` hooks (`useTable`, `useForm`, `useShow`, `useSelect`) to keep state, filters, pagination, and data synchronization clean and predictable.
- **Frontend Design Excellence**: High visual hierarchy with custom Ant Design tokens, clear Expiry Date (ED) status tags (`expired`, `nearExpiry`, `safe`), polished monospaced SKU/batch displays, and smooth hover micro-interactions.
- **Structured 2-Column Form & Detail Layout**: Organize `ProductCreate`/`ProductEdit` forms and `ProductShow` details into a clear 2-column grid on desktop (Main Info vs Sticky Sidebar) that collapses cleanly to a single column on mobile.

---

## 2. Component Architecture & Responsive Breakpoints

### Breakpoint Matrix (Ant Design `Grid.useBreakpoint()`)
| Viewport | Range | Product List UI | Form (Edit/Create) UI | Show Detail UI |
| --- | --- | --- | --- | --- |
| **Mobile (`xs`)** | `< 576px` | 1-Column `ProductCard` List, Collapsible Filter Drawer | Single column stacked form | Single column gallery & meta stack |
| **Tablet (`sm`)** | `576px - 767px` | 2-Column `ProductCard` Grid, Compact 2-row filter header | Single column stacked form | Single column gallery & meta stack |
| **Desktop (`md/lg/xl`)** | `≥ 768px` | Full AntD `Table` with `scroll={{ x: 1000 }}` and fixed actions | 2-Column (`md={16}` Main + `md={8}` Sticky Sidebar) | 2-Column Gallery (Left) + Meta Card (Right) |

### File Structure & Changes:
1. `src/pages/products/components/ProductCard.tsx` **(New)**:
   - Renders individual product cards for mobile viewports.
   - Includes thumbnail image (72x72px), multi-line name truncation, price in IDR format, stock level badge, expiry status pill tag, and popover quick action menu (`Show`, `Edit`, `Delete`, `OFF`).
2. `src/pages/products/list.tsx`:
   - Integrates `useBreakpoint()` to toggle conditionally between `Table` and `ProductCard` list.
   - Adds mobile filter trigger button opening a responsive `Drawer`.
3. `src/pages/products/edit.tsx` & `create.tsx`:
   - Re-architects form grid into `<Row gutter={[24, 24]}>` with `<Col xs={24} md={16}>` (Name, SKU, Slug, Description, Pharmacy ED & Batch) and `<Col xs={24} md={8}>` (Media Upload, Pricing, Stock, Weight, Active Status).
4. `src/pages/products/show.tsx`:
   - Re-architects product detail view into a 2-column Grid with image gallery showcase on the left and structured meta cards on the right.

---

## 3. Data Flow & Refine Integration

- **Search & Filtering (`useTable`)**:
  - Debounced text search (400ms) matching name or SKU via `buildProductSearchFilter`.
  - Filters combined into `CrudFilters` array for category, active status, and expiry date ranges (`buildExpiryFilters`).
- **Storage Resolution**:
  - Media URLs resolved using `resolveStoragePublicUrl(url, MEDIA_BUCKET)` with visual fallback placeholder for broken or missing images.
- **Product Deactivation Mutation (`useUpdate`)**:
  - Deactivation confirmation via popconfirm/modal triggering `useUpdate` for products within 30 days of ED.
- **Form Submission (`useForm` & `useProductSkuField`)**:
  - Form validation with normalized SKU checks and image list re-ordering maintaining `sort_order` in `product_images`.

---

## 4. Testing & Quality Assurance

- **Unit Tests**:
  - Update `src/pages/__tests__/lists.test.tsx` to verify both `Table` render on desktop and `ProductCard` grid render on mobile breakpoints.
  - Update `src/pages/__tests__/forms.test.tsx` and `details.test.tsx` to verify layout rendering and interaction callbacks under the new grid layout.
- **Lint & Build**:
  - Code must adhere to TypeScript strict mode and clean architecture.

---

## 5. Verification Checklist

- [ ] Desktop layout shows full Ant Design Table with sticky action column.
- [ ] Mobile layout displays responsive `ProductCard` list with mobile filter drawer.
- [ ] Create and Edit forms render a clean 2-column layout on desktop and single column on mobile.
- [ ] Product Show page displays responsive image gallery and structured meta information.
- [ ] `pnpm build` and `pnpm test` pass with 0 errors.
