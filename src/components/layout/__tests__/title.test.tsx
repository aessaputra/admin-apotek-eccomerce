import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthTitle } from "../auth-title";
import { Title } from "../title";

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string) => (key === "app.title" ? "Pharmacy" : key));
  const useStoreBranding = vi.fn<() => { storeName: string | null; primaryLogoUrl: string | null }>(() => ({
    storeName: null,
    primaryLogoUrl: null,
  }));
  const themedTitle = vi.fn(
    ({ collapsed, text, icon }: { collapsed: boolean; text: string; icon: React.ReactNode }) => (
      <div data-testid="themed-title" data-collapsed={String(collapsed)}>
        <div data-testid="themed-title-text">{text}</div>
        <div data-testid="themed-title-icon">{icon}</div>
      </div>
    )
  );

  return { translate, themedTitle, useStoreBranding };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("@refinedev/antd", () => ({
  ThemedTitle: mocks.themedTitle,
}));

vi.mock("../../../hooks/useStoreBranding", () => ({
  useStoreBranding: () => mocks.useStoreBranding(),
}));

describe("layout titles", () => {
  it("renders the main layout title with the store name when available", () => {
    mocks.useStoreBranding.mockReturnValue({
      storeName: "Apotek Sehat",
      primaryLogoUrl: "https://cdn.example.com/settings/logo.png",
    });

    const { container } = render(<Title collapsed />);

    expect(screen.getByTestId("themed-title").getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByTestId("themed-title-text").textContent).toBe("Apotek Sehat");
    const icon = container.querySelector('img[src="https://cdn.example.com/settings/logo.png"]');
    expect(icon).not.toBeNull();
  });

  it("falls back to the translated app name when the store name is unavailable", () => {
    mocks.useStoreBranding.mockReturnValue({ storeName: null, primaryLogoUrl: null });

    const { container } = render(<Title collapsed={false} />);

    expect(screen.getByTestId("themed-title-text").textContent).toBe("Pharmacy");
    expect(container.querySelector('img[src="/logo-icon.png"]')).not.toBeNull();
  });

  it("renders the auth title in expanded mode using the store name", () => {
    mocks.useStoreBranding.mockReturnValue({
      storeName: "Apotek Sehat",
      primaryLogoUrl: "https://cdn.example.com/settings/logo.png",
    });

    const { container } = render(<AuthTitle />);

    expect(screen.getByTestId("themed-title").getAttribute("data-collapsed")).toBe("false");
    expect(screen.getByTestId("themed-title-text").textContent).toBe("Apotek Sehat");
    expect(container.querySelector('img[src="https://cdn.example.com/settings/logo.png"]')).not.toBeNull();
  });

  it("falls back to the translated app name on auth pages when the store name is unavailable", () => {
    mocks.useStoreBranding.mockReturnValue({ storeName: null, primaryLogoUrl: null });

    const { container } = render(<AuthTitle />);

    expect(screen.getByTestId("themed-title-text").textContent).toBe("Pharmacy");
    expect(container.querySelector('img[src="/logo-icon.png"]')).not.toBeNull();
  });

  it("falls back to the local logo when the configured image fails to load", () => {
    mocks.useStoreBranding.mockReturnValue({
      storeName: "Apotek Sehat",
      primaryLogoUrl: "https://cdn.example.com/settings/broken-logo.png",
    });

    const { container } = render(<Title collapsed={false} />);

    const icon = container.querySelector('img[src="https://cdn.example.com/settings/broken-logo.png"]');
    expect(icon).not.toBeNull();

    if (!icon) {
      throw new Error("Expected branding icon to be rendered");
    }

    fireEvent.error(icon);

    expect(icon.getAttribute("src")).toBe("/logo-icon.png");
  });
});
