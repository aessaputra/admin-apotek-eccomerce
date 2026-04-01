import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ColorModeContext } from "../context";
import { ColorModeContextProvider } from "..";

vi.mock("@refinedev/antd", () => ({
  RefineThemes: {
    Blue: { token: { colorPrimary: "#1677ff" } },
  },
}));

vi.mock("antd", () => ({
  ConfigProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="config-provider">{children}</div>
  ),
  theme: {
    darkAlgorithm: "dark-algorithm",
    defaultAlgorithm: "light-algorithm",
  },
}));

function Consumer() {
  const { mode, setMode } = useContext(ColorModeContext);

  return (
    <>
      <span data-testid="mode">{mode}</span>
      <button type="button" onClick={setMode}>
        toggle
      </button>
    </>
  );
}

describe("ColorModeContextProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-color-scheme: dark)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("uses the stored color mode when available", () => {
    localStorage.setItem("colorMode", "dark");

    render(
      <ColorModeContextProvider>
        <Consumer />
      </ColorModeContextProvider>
    );

    expect(screen.getByTestId("mode").textContent).toBe("dark");
  });

  it("falls back to system preference when there is no stored mode", () => {
    render(
      <ColorModeContextProvider>
        <Consumer />
      </ColorModeContextProvider>
    );

    expect(screen.getByTestId("mode").textContent).toBe("dark");
  });

  it("toggles the mode and persists it to localStorage", async () => {
    localStorage.setItem("colorMode", "light");

    render(
      <ColorModeContextProvider>
        <Consumer />
      </ColorModeContextProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    await waitFor(() => {
      expect(screen.getByTestId("mode").textContent).toBe("dark");
      expect(localStorage.getItem("colorMode")).toBe("dark");
    });
  });
});
