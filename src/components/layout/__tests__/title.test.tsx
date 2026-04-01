import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthTitle } from "../auth-title";
import { Title } from "../title";

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string) => (key === "app.title" ? "Pharmacy" : key));
  const themedTitle = vi.fn(
    ({ collapsed, text, icon }: { collapsed: boolean; text: string; icon: React.ReactNode }) => (
      <div data-testid="themed-title" data-collapsed={String(collapsed)}>
        <div data-testid="themed-title-text">{text}</div>
        <div data-testid="themed-title-icon">{icon}</div>
      </div>
    )
  );

  return { translate, themedTitle };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("@refinedev/antd", () => ({
  ThemedTitle: mocks.themedTitle,
}));

describe("layout titles", () => {
  it("renders the main layout title with the translated app name and collapsed state", () => {
    const { container } = render(<Title collapsed />);

    expect(screen.getByTestId("themed-title").getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByTestId("themed-title-text").textContent).toBe("Pharmacy");
    const icon = container.querySelector('img[src="/logo-icon.png"]');
    expect(icon).not.toBeNull();
  });

  it("renders the auth title in expanded mode", () => {
    render(<AuthTitle />);

    expect(screen.getByTestId("themed-title").getAttribute("data-collapsed")).toBe("false");
    expect(screen.getByTestId("themed-title-text").textContent).toBe("Pharmacy");
  });
});
