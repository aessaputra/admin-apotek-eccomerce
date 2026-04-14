import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeBannerMediaLibrary } from "../index";

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string) => key);
  const supabaseStorageList = vi.fn();
  const supabaseStorageRemove = vi.fn();
  const supabaseFromSelect = vi.fn();
  const modalConfirm = vi.fn(({ onOk }: { onOk?: () => void }) => onOk?.());
  const modalError = vi.fn();

  return {
    translate,
    supabaseStorageList,
    supabaseStorageRemove,
    supabaseFromSelect,
    modalConfirm,
    modalError,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("antd", async () => {
  const ListComponent = ({ dataSource, renderItem }: { dataSource: unknown[]; renderItem: (item: unknown, index: number) => React.ReactNode }) => (
    <div data-testid="list">
      {dataSource.map((item, index) => {
        const key =
          typeof item === "object" &&
          item !== null &&
          "id" in item &&
          typeof (item as { id?: unknown }).id === "string"
            ? (item as { id: string }).id
            : String(index);

        return <React.Fragment key={key}>{renderItem(item, index)}</React.Fragment>;
      })}
    </div>
  );

  const CardComponent = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    onClick ?
      <button type="button" data-testid="card" onClick={onClick} className="card-mock">{children}</button>
    :
      <div data-testid="card" className="card-mock">{children}</div>
  );

  return {
    App: {
      useApp: () => ({
        modal: {
          confirm: mocks.modalConfirm,
          error: mocks.modalError,
        },
      }),
    },
    List: Object.assign(ListComponent, {
      Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    }),
    Card: CardComponent,
    Button: ({ children, onClick, loading, danger, icon }: { children?: React.ReactNode; onClick?: () => void; loading?: boolean; danger?: boolean; icon?: React.ReactNode }) => (
      <button type="button" onClick={onClick} disabled={loading} data-danger={danger}>
        {icon}{children}
      </button>
    ),
    Empty: ({ description }: { description: string }) => <div data-testid="empty">{description}</div>,
    Flex: ({ children, gap }: { children: React.ReactNode; gap?: number }) => <div data-gap={gap}>{children}</div>,
    Image: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt} />,
    Modal: ({ open, onCancel, title, children }: { open: boolean; onCancel: () => void; title?: string; children: React.ReactNode }) => (
      open ? <div data-testid="modal" data-title={title}>
        <button type="button" onClick={onCancel}>Close</button>
        {children}
      </div> : null
    ),
    Popconfirm: ({ children, onConfirm }: { children: React.ReactNode; onConfirm?: () => void }) => (
      <div data-testid="popconfirm">
        {children}
        <button type="button" onClick={onConfirm} data-testid="confirm-delete">Confirm</button>
      </div>
    ),
    Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Spin: () => <div data-testid="spin">Loading...</div>,
    Typography: {
      Text: ({ children, strong }: { children: React.ReactNode; strong?: boolean }) => (
        <span data-strong={strong}>{children}</span>
      ),
    },
    message: {
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("../../../constants/home-banners", () => ({
  getHomeBannerStoragePrefix: (key: string) => `banners/${key}/`,
  isHomeBannerPlacementKey: (value: unknown) => value === "home_banner_top" || value === "home_banner_bottom",
}));

vi.mock("../../../providers/supabase-client", () => ({
  supabaseClient: {
    storage: {
      from: vi.fn(() => ({
        list: mocks.supabaseStorageList,
        remove: mocks.supabaseStorageRemove,
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: mocks.supabaseFromSelect,
      })),
    })),
  },
}));

vi.mock("../../../utils/storage", () => ({
  getPublicUrlFromStoragePath: (path: string) => `https://example.com/storage/${path}`,
  MEDIA_BUCKET: "media",
}));

describe("HomeBannerMediaLibrary", () => {
  const mockOnSelect = vi.fn();

  beforeEach(() => {
    mocks.translate.mockClear();
    mocks.supabaseStorageList.mockReset();
    mocks.supabaseStorageRemove.mockReset();
    mocks.supabaseFromSelect.mockReset();
    mocks.modalConfirm.mockClear();
    mocks.modalError.mockClear();
    mockOnSelect.mockClear();
  });

  it("shows placement hint when no placement is selected", () => {
    render(
      <HomeBannerMediaLibrary
        placementKey={null}
        selectedPath={null}
        onSelect={mockOnSelect}
      />
    );

    expect(screen.getByText("homeBanners.mediaLibrary.selectPlacementHint")).not.toBeNull();
  });

  it("loads and displays media assets for selected placement", async () => {
    mocks.supabaseStorageList.mockResolvedValue({
      data: [
        { name: "banner1.webp", id: "1", created_at: "2026-04-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z", last_accessed_at: "2026-04-01T00:00:00Z", metadata: {} },
        { name: "banner2.webp", id: "2", created_at: "2026-04-02T00:00:00Z", updated_at: "2026-04-02T00:00:00Z", last_accessed_at: "2026-04-02T00:00:00Z", metadata: {} },
      ],
      error: null,
    });

    render(
      <HomeBannerMediaLibrary
        placementKey="home_banner_top"
        selectedPath={null}
        onSelect={mockOnSelect}
      />
    );

    await waitFor(() => {
      expect(mocks.supabaseStorageList).toHaveBeenCalledWith(
        "banners/home_banner_top/",
        expect.objectContaining({ limit: 100 })
      );
    });
  });

  it("shows empty state when no assets found", async () => {
    mocks.supabaseStorageList.mockResolvedValue({
      data: [],
      error: null,
    });

    render(
      <HomeBannerMediaLibrary
        placementKey="home_banner_top"
        selectedPath={null}
        onSelect={mockOnSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("empty")).not.toBeNull();
    });
  });

  it("blocks deletion when media is referenced by banners", async () => {
    mocks.supabaseStorageList.mockResolvedValue({
      data: [
        { name: "banner1.webp", id: "1", created_at: "2026-04-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z", last_accessed_at: "2026-04-01T00:00:00Z", metadata: {} },
      ],
      error: null,
    });

    mocks.supabaseFromSelect.mockResolvedValue({
      data: [{ id: "banner-123" }],
      error: null,
    });

    render(
      <HomeBannerMediaLibrary
        placementKey="home_banner_top"
        selectedPath={null}
        onSelect={mockOnSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("list")).not.toBeNull();
    });

    const confirmButton = screen.getByTestId("confirm-delete");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mocks.supabaseFromSelect).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mocks.modalError).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "homeBanners.mediaLibrary.deleteBlockedTitle",
        })
      );
    });
  });

  it("allows deletion when media is not referenced", async () => {
    mocks.supabaseStorageList.mockResolvedValue({
      data: [
        { name: "banner1.webp", id: "1", created_at: "2026-04-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z", last_accessed_at: "2026-04-01T00:00:00Z", metadata: {} },
      ],
      error: null,
    });

    mocks.supabaseFromSelect.mockResolvedValue({
      data: [],
      error: null,
    });

    mocks.supabaseStorageRemove.mockResolvedValue({
      data: [{ name: "banner1.webp" }],
      error: null,
    });

    render(
      <HomeBannerMediaLibrary
        placementKey="home_banner_top"
        selectedPath={null}
        onSelect={mockOnSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("list")).not.toBeNull();
    });

    const confirmButton = screen.getByTestId("confirm-delete");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mocks.supabaseFromSelect).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mocks.supabaseStorageRemove).toHaveBeenCalled();
    });
  });

  it("calls onSelect when asset is clicked", async () => {
    mocks.supabaseStorageList.mockResolvedValue({
      data: [
        { name: "banner1.webp", id: "1", created_at: "2026-04-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z", last_accessed_at: "2026-04-01T00:00:00Z", metadata: {} },
      ],
      error: null,
    });

    render(
      <HomeBannerMediaLibrary
        placementKey="home_banner_top"
        selectedPath={null}
        onSelect={mockOnSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("select-area")).not.toBeNull();
    });

    const selectArea = screen.getByTestId("select-area");
    fireEvent.click(selectArea);

    expect(mockOnSelect).toHaveBeenCalledWith("banners/home_banner_top/banner1.webp");
  });
});
