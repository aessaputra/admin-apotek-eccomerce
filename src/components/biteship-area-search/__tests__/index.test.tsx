import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BiteshipAreaSearch } from "..";

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string, defaultMessage?: string) => defaultMessage ?? key);
  const getSession = vi.fn();
  const autoCompleteProps: Array<{
    onSearch: (value: string) => void;
    onSelect: (value: string, option: { area: { id: string; name: string; postal_code: number } }) => void;
    onBlur: () => void;
    onFocus: () => void;
    value?: string;
    options?: Array<{ value: string; area: { id: string; name: string; postal_code: number } }>;
    placeholder?: string;
  }> = [];

  return {
    translate,
    getSession,
    autoCompleteProps,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("../../../providers/supabase-client", () => ({
  supabaseClient: {
    auth: {
      getSession: mocks.getSession,
    },
  },
}));

vi.mock("antd", () => ({
  AutoComplete: (props: {
    value?: string;
    options?: Array<{ value: string; area: { id: string; name: string; postal_code: number } }>;
    onSearch: (value: string) => void;
    onSelect: (value: string, option: { area: { id: string; name: string; postal_code: number } }) => void;
    onBlur: () => void;
    onFocus: () => void;
    placeholder?: string;
  }) => {
    mocks.autoCompleteProps.push(props);
    const firstOption = props.options?.[0];

    return (
      <div>
        <input
          aria-label="area-search"
          value={props.value ?? ""}
          placeholder={props.placeholder}
          onChange={(event) => props.onSearch(event.target.value)}
          onBlur={props.onBlur}
          onFocus={props.onFocus}
        />
        <div data-testid="options-count">{String(props.options?.length ?? 0)}</div>
        <button
          type="button"
          disabled={!firstOption}
          onClick={() => firstOption && props.onSelect(firstOption.value, firstOption)}
        >
          select-first
        </button>
      </div>
    );
  },
  Spin: () => <div>loading</div>,
  Typography: {
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  },
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe("BiteshipAreaSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.translate.mockClear();
    mocks.getSession.mockReset();
    mocks.autoCompleteProps.length = 0;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not search before the minimum query length", async () => {
    render(<BiteshipAreaSearch placeholder="Search area" />);

    fireEvent.change(screen.getByLabelText("area-search"), {
      target: { value: "ab" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("options-count").textContent).toBe("0");
  });

  it("loads area options from the edge function and returns selected area data", async () => {
    const onChange = vi.fn();
    const onAreaSelect = vi.fn();
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          areas: [
            {
              id: "area-1",
              name: "Jakarta Selatan",
              postal_code: 12345,
              country_name: "Indonesia",
              country_code: "ID",
              administrative_division_level_1_name: "DKI Jakarta",
              administrative_division_level_2_name: "South Jakarta",
            },
          ],
        }),
      })
    );

    render(
      <BiteshipAreaSearch
        placeholder="Search area"
        onChange={onChange}
        onAreaSelect={onAreaSelect}
      />
    );

    fireEvent.change(screen.getByLabelText("area-search"), {
      target: { value: "jakarta" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("options-count").textContent).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "select-first" }));

    expect(onChange).toHaveBeenCalledWith("area-1");
    expect(onAreaSelect).toHaveBeenCalledWith({
      areaId: "area-1",
      areaName: "Jakarta Selatan",
      postalCode: 12345,
    });
  });

  it("clears options when there is no session token", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    render(<BiteshipAreaSearch placeholder="Search area" />);

    fireEvent.change(screen.getByLabelText("area-search"), {
      target: { value: "bandung" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("options-count").textContent).toBe("0");
  });
});
