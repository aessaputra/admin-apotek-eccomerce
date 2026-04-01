import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Header } from "..";
import { ColorModeContext } from "../../../contexts/color-mode";

const mocks = vi.hoisted(() => {
  type IdentityResult = {
    data: { id: string; name: string; avatar: string } | null;
  };

  const logout = vi.fn();
  const translate = vi.fn((key: string) => {
    const messages: Record<string, string> = {
      "profile.myProfile": "My Profile",
      "buttons.logout": "Logout",
    };
    return messages[key] ?? key;
  });
  const changeLocale = vi.fn();
  const setMode = vi.fn();
  const useGetIdentity = vi.fn((): IdentityResult => ({
    data: { id: "user-1", name: "Alice", avatar: "https://example.com/a.png" },
  }));

  return {
    logout,
    translate,
    changeLocale,
    setMode,
    useGetIdentity,
  };
});

vi.mock("@refinedev/core", () => ({
  useGetIdentity: mocks.useGetIdentity,
  useLogout: () => ({ mutate: mocks.logout }),
  useTranslation: () => ({
    translate: mocks.translate,
    changeLocale: mocks.changeLocale,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "id" },
  }),
}));

vi.mock("react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("antd", () => ({
  Layout: {
    Header: ({ style, children }: { style?: React.CSSProperties; children: React.ReactNode }) => (
      <div data-testid="header" style={style}>
        {children}
      </div>
    ),
  },
  Avatar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  Dropdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Select: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <select
      aria-label="language"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="id">ID</option>
      <option value="en">EN</option>
    </select>
  ),
  Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Switch: ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <input
      aria-label="color-mode"
      type="checkbox"
      checked={checked}
      onChange={onChange}
    />
  ),
  theme: {
    useToken: () => ({ token: { colorBgElevated: "rgb(255, 255, 255)" } }),
  },
}));

vi.mock("@ant-design/icons", () => ({
  DownOutlined: () => <span>down</span>,
  LogoutOutlined: () => <span>logout</span>,
  UserOutlined: () => <span>user</span>,
}));

describe("Header", () => {
  it("renders user info and sticky styles when identity is available", () => {
    render(
      <ColorModeContext.Provider value={{ mode: "light", setMode: mocks.setMode }}>
        <Header sticky />
      </ColorModeContext.Provider>
    );

    expect(screen.getByTestId("header").style.position).toBe("sticky");
    expect(screen.getByTestId("header").style.top).toBe("0px");
    expect(screen.getByText("Alice")).not.toBeNull();
    expect((screen.getByLabelText("language") as HTMLSelectElement).value).toBe("id");
  });

  it("changes locale and toggles color mode from header controls", () => {
    render(
      <ColorModeContext.Provider value={{ mode: "light", setMode: mocks.setMode }}>
        <Header sticky={false} />
      </ColorModeContext.Provider>
    );

    fireEvent.change(screen.getByLabelText("language"), {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByLabelText("color-mode"));

    expect(mocks.changeLocale).toHaveBeenCalledWith("en");
    expect(mocks.setMode).toHaveBeenCalledTimes(1);
  });

  it("hides the profile dropdown trigger when no identity exists", () => {
    mocks.useGetIdentity.mockReturnValueOnce({ data: null });

    render(
      <ColorModeContext.Provider value={{ mode: "dark", setMode: mocks.setMode }}>
        <Header />
      </ColorModeContext.Provider>
    );

    expect(screen.queryByText("Alice")).toBeNull();
  });
});
