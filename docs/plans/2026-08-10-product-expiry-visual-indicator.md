# Product Expiry Visual Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refine product expiry UI across `ProductList`, `ProductCard`, and `ProductShow` by replacing tag pills in list/card views with color-coded date text, while moving full status tag pills to the detail page (`ProductShow`).

**Architecture:** 
- `renderExpiryStatusCell` in `src/pages/products/list.tsx` and `ProductCard` in `src/pages/products/components/ProductCard.tsx` render color-coded date text without Tag pills.
- `ProductShow` in `src/pages/products/show.tsx` renders full status Tag pills alongside color-coded date text.

---

### Task 1: Update Expiry Cell in `ProductList` (`list.tsx`)

**Files:**
- Modify: `src/pages/products/list.tsx`
- Modify: `src/pages/__tests__/lists.test.tsx`

**Steps:**
1. Update `renderExpiryStatusCell`:
   - Remove `<Tag>` wrapper for all expiry statuses.
   - For `isExpired`: Return `<Typography.Text type="danger" style={{ fontSize: 12 }}>{formattedDate}</Typography.Text>`.
   - For `isNearExpiry`: Return `<Typography.Text style={{ fontSize: 12, color: "#d48806", fontWeight: 500 }}>{formattedDate}</Typography.Text>`.
   - For `isSafe`: Return `<Typography.Text type="secondary" style={{ fontSize: 12 }}>{formattedDate}</Typography.Text>`.
2. Run test: `pnpm vitest run src/pages/__tests__/lists.test.tsx`
3. Commit: `git add src/pages/products/list.tsx src/pages/__tests__/lists.test.tsx && git commit -m "feat(products): use color-coded expiry date text without tags in ProductList"`

---

### Task 2: Update Expiry Display in `ProductCard` (`ProductCard.tsx`)

**Files:**
- Modify: `src/pages/products/components/ProductCard.tsx`
- Modify: `src/pages/products/components/__tests__/ProductCard.test.tsx`

**Steps:**
1. Remove `<Tag>` rendering from `ProductCard`.
2. Render `expDate` formatted as `DD MMM YYYY` with color styling:
   - `isExpired`: Red text (`type="danger"`).
   - `isNearExpiry`: Amber/Orange text (`style={{ color: "#d48806", fontWeight: 500 }}`).
   - `isSafe`: Secondary Gray text (`type="secondary"`).
3. Update `ProductCard.test.tsx` assertions to check for formatted color-coded date text and verify no Tag pill is rendered.
4. Run test: `pnpm vitest run src/pages/products/components/__tests__/ProductCard.test.tsx`
5. Commit: `git add src/pages/products/components/ProductCard.tsx src/pages/products/components/__tests__/ProductCard.test.tsx && git commit -m "feat(products): use color-coded expiry date text without tags in ProductCard"`

---

### Task 3: Update `ProductShow` (`show.tsx`) to Render Expiry Status Tag

**Files:**
- Modify: `src/pages/products/show.tsx`
- Modify: `src/pages/__tests__/details.test.tsx`

**Steps:**
1. In `ProductShow`, compute `isExpired` and `isNearExpiry` for `record.expiry_date`.
2. Display Tag pills on the Detail page:
   - `isExpired`: `<Tag color="error" bordered={false} style={{ fontWeight: 500 }}>Kedaluwarsa</Tag>` + Red date text.
   - `isNearExpiry`: `<Tag color="warning" bordered={false} style={{ fontWeight: 500 }}>Mendekati ED</Tag>` + Amber/Orange date text.
   - `isSafe`: Formatted date text without Tag pill.
3. Run test: `pnpm vitest run src/pages/__tests__/details.test.tsx`
4. Commit: `git add src/pages/products/show.tsx src/pages/__tests__/details.test.tsx && git commit -m "feat(products): render expiry status tag pills in ProductShow detail page"`

---

### Task 4: Final Validation & Build Verification

**Steps:**
1. Run full test suite: `pnpm test`
2. Run build verification: `pnpm build`
3. Verify git status is clean.
