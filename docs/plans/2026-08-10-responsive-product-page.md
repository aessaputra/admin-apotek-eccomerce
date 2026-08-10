# Responsive Product Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform product pages (`list`, `show`, `edit`, `create`) into adaptive, responsive UI layouts with mobile card view support and 2-column form grids.

**Architecture:** Adaptive breakpoint strategy using Ant Design `Grid.useBreakpoint()`, custom `ProductCard` component for mobile list view, Refine.dev hooks (`useTable`, `useForm`), and sticky sidebar forms on desktop.

**Tech Stack:** React 19, Refine v5, Ant Design v5, Vitest, Supabase Storage helper.

---

### Task 1: Create Mobile `ProductCard` Component

**Files:**
- Create: `src/pages/products/components/ProductCard.tsx`
- Create: `src/pages/products/components/__tests__/ProductCard.test.tsx`

**Step 1: Write failing test for `ProductCard`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { ProductCard } from "../ProductCard";

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({
    translate: (key: string, fallback?: string) => fallback || key,
  }),
  useUpdate: () => ({ mutate: vi.fn() }),
}));

vi.mock("@refinedev/antd", () => ({
  ShowButton: () => <button>Show</button>,
  EditButton: () => <button>Edit</button>,
  DeleteButton: () => <button>Delete</button>,
}));

describe("ProductCard", () => {
  const sampleProduct = {
    id: "prod-1",
    name: "Paracetamol 500mg",
    sku: "PRC-500",
    price: 15000,
    stock: 25,
    expiry_date: "2026-12-31",
    is_active: true,
    product_images: [{ url: "paracetamol.jpg" }],
    categories: { name: "Obat Bebas" },
  };

  it("renders product details correctly", () => {
    render(<ProductCard record={sampleProduct} onDeactivate={vi.fn()} />);
    expect(screen.getByText("Paracetamol 500mg")).toBeInTheDocument();
    expect(screen.getByText("PRC-500")).toBeInTheDocument();
    expect(screen.getByText("Rp 15.000")).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/pages/products/components/__tests__/ProductCard.test.tsx`
Expected: FAIL with module/component missing error.

**Step 3: Implement `ProductCard` component**

```tsx
import React from "react";
import { Card, Image, Tag, Typography, Space, Button, Popconfirm, Dropdown } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import { ShowButton, EditButton, DeleteButton } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import dayjs from "dayjs";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../../../utils/storage";

interface ProductImage {
  url: string;
}

export interface ProductRecord {
  id: string;
  name?: string;
  sku?: string;
  slug?: string;
  price?: number | string;
  stock?: number | null;
  weight?: number | null;
  batch_number?: string;
  expiry_date?: string;
  is_active?: boolean;
  product_images?: ProductImage[];
  categories?: { name: string } | null;
}

interface ProductCardProps {
  record: ProductRecord;
  onDeactivate?: (id: string) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ record, onDeactivate }) => {
  const { translate } = useTranslation();
  const previewUrl = resolveStoragePublicUrl(record.product_images?.[0]?.url ?? null, MEDIA_BUCKET);

  const today = dayjs();
  const expDate = record.expiry_date ? dayjs(record.expiry_date) : null;
  const isExpired = expDate ? expDate.isSameOrBefore(today, "day") : false;
  const isNearExpiry = !isExpired && expDate ? expDate.diff(today, "day") <= 30 : false;

  const tagColor = isExpired ? "error" : isNearExpiry ? "warning" : "success";
  const tagLabel = isExpired
    ? translate("products.expiryStatus.expired", "Kedaluwarsa")
    : isNearExpiry
    ? translate("products.expiryStatus.nearExpiry", "Mendekati ED")
    : translate("products.expiryStatus.safe", "Aman");

  const actionItems = [
    {
      key: "show",
      label: <ShowButton hideText={false} size="small" recordItemId={record.id} />,
    },
    {
      key: "edit",
      label: <EditButton hideText={false} size="small" recordItemId={record.id} />,
    },
    {
      key: "delete",
      label: <DeleteButton hideText={false} size="small" recordItemId={record.id} />,
    },
  ];

  return (
    <Card size="small" hoverable style={{ borderRadius: 8, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flexShrink: 0 }}>
          {previewUrl ? (
            <Image src={previewUrl} alt="" width={72} height={72} style={{ objectFit: "cover", borderRadius: 6 }} />
          ) : (
            <div style={{ width: 72, height: 72, background: "#f0f0f0", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#999" }}>
              No Img
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <Typography.Text bold ellipsis={{ rows: 2 }} style={{ fontSize: 14 }}>
              {record.name || "-"}
            </Typography.Text>
            <Dropdown menu={{ items: actionItems }} trigger={["click"]}>
              <Button type="text" icon={<MoreOutlined />} size="small" />
            </Dropdown>
          </div>
          <Space size={4} wrap style={{ marginTop: 4 }}>
            {record.sku && <Typography.Text type="secondary" code style={{ fontSize: 11 }}>{record.sku}</Typography.Text>}
            <Tag color={tagColor} style={{ fontSize: 10, margin: 0 }}>{tagLabel}</Tag>
          </Space>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <Typography.Text type="danger" style={{ fontWeight: 600 }}>
              Rp {Number(record.price || 0).toLocaleString("id-ID")}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Stok: {record.stock ?? 0}
            </Typography.Text>
          </div>
        </div>
      </div>
    </Card>
  );
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/pages/products/components/__tests__/ProductCard.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/products/components/ProductCard.tsx src/pages/products/components/__tests__/ProductCard.test.tsx
git commit -m "feat(products): create responsive ProductCard component for mobile list view"
```

---

### Task 2: Update `ProductList` for Responsive Table & Card Toggle

**Files:**
- Modify: `src/pages/products/list.tsx`
- Modify: `src/pages/__tests__/lists.test.tsx`

**Step 1: Write/Update test for responsive behavior in `list.tsx`**

Verify that list renders correctly without crash and displays mobile or desktop elements based on screen breakpoint.

**Step 2: Run test to verify current state**

Run: `pnpm vitest run src/pages/__tests__/lists.test.tsx`

**Step 3: Update `ProductList` (`src/pages/products/list.tsx`)**

- Import `Grid` from `antd` (`const screens = Grid.useBreakpoint();`).
- Import `ProductCard` from `./components/ProductCard`.
- Render `screens.md ? <Table ... /> : <Space direction="vertical" style={{ width: "100%" }}>{tableProps.dataSource?.map(record => <ProductCard key={record.id} record={record} onDeactivate={handleDeactivateProduct} />)}</Space>`.
- Add collapsible/drawer container for mobile filter row.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/pages/__tests__/lists.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/products/list.tsx src/pages/__tests__/lists.test.tsx
git commit -m "feat(products): make ProductList responsive with mobile Card view fallback"
```

---

### Task 3: Restructure `ProductEdit` & `ProductCreate` into 2-Column Responsive Layout

**Files:**
- Modify: `src/pages/products/edit.tsx`
- Modify: `src/pages/products/create.tsx`
- Modify: `src/pages/__tests__/forms.test.tsx`

**Step 1: Check form tests**

Run: `pnpm vitest run src/pages/__tests__/forms.test.tsx`

**Step 2: Restructure Form Grid in `edit.tsx` and `create.tsx`**

Wrap Form controls in `<Row gutter={[24, 24]}>`:
- `<Col xs={24} md={16}>`: Name, SKU, Slug, Description, Expiry Date, Batch Number, Category.
- `<Col xs={24} md={8}>`: Sticky Card container holding Image Upload (`ProductImageUpload`), Price, Stock, Weight (`ProductWeightInput`), and Active status toggle.

**Step 3: Run form tests to verify**

Run: `pnpm vitest run src/pages/__tests__/forms.test.tsx`
Expected: PASS

**Step 4: Commit**

```bash
git add src/pages/products/edit.tsx src/pages/products/create.tsx src/pages/__tests__/forms.test.tsx
git commit -m "feat(products): update ProductEdit and ProductCreate forms to 2-column responsive layout"
```

---

### Task 4: Restructure `ProductShow` into 2-Column Responsive Layout

**Files:**
- Modify: `src/pages/products/show.tsx`
- Modify: `src/pages/__tests__/details.test.tsx`

**Step 1: Check detail tests**

Run: `pnpm vitest run src/pages/__tests__/details.test.tsx`

**Step 2: Restructure `ProductShow` (`show.tsx`)**

Wrap `<Show>` contents into `<Row gutter={[24, 24]}>`:
- `<Col xs={24} md={10}>`: Image gallery showcase.
- `<Col xs={24} md={14}>`: Structured metadata cards (Name, Price, SKU, Slug, Category, Stock, Weight, ED, Active Tag).

**Step 3: Run detail tests to verify**

Run: `pnpm vitest run src/pages/__tests__/details.test.tsx`
Expected: PASS

**Step 4: Commit**

```bash
git add src/pages/products/show.tsx src/pages/__tests__/details.test.tsx
git commit -m "feat(products): update ProductShow detail page to responsive grid layout"
```

---

### Task 5: Final Validation & Build Check

**Step 1: Run whole test suite**

Run: `pnpm test`
Expected: All tests pass.

**Step 2: Run application build**

Run: `pnpm build`
Expected: Build succeeds with 0 TypeScript/bundler errors.

**Step 3: Commit final updates if any**

```bash
git commit -m "chore(products): finalize responsive product page redesign"
```
