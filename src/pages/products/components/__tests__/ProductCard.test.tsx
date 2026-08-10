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
    expect(screen.getByText("Paracetamol 500mg")).not.toBeNull();
    expect(screen.getByText("PRC-500")).not.toBeNull();
    expect(screen.getByText("Rp 15.000")).not.toBeNull();
  });
});
