import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapLocationPicker from "..";

const mocks = vi.hoisted(() => {
  const messageError = vi.fn();
  const flyTo = vi.fn();
  const on = vi.fn();
  const off = vi.fn();
  const markerPosition = { lat: -6.3, lng: 106.9 };
  const translate = vi.fn((key: string, params?: Record<string, unknown>, fallback?: string) => {
    if (key === "settings.mapLocationPicker.searchPlaceholder") {
      return "Cari apotek, klinik, kecamatan, atau lokasi...";
    }

    if (key === "settings.mapLocationPicker.searchError") {
      return "Gagal mencari lokasi. Silakan coba lagi.";
    }

    if (key === "settings.mapLocationPicker.interactionHint") {
      return "Atau klik pada peta atau seret pin untuk memilih lokasi yang lebih presisi.";
    }

    if (key === "settings.mapLocationPicker.selectResultAria") {
      return `Pilih ${params?.location ?? ""}`;
    }

    if (key === "settings.mapLocationPicker.closeResultsAria") {
      return "Tutup hasil pencarian";
    }

    return fallback ?? key;
  });

  return {
    messageError,
    flyTo,
    on,
    off,
    markerPosition,
    translate,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("antd", () => ({
  Input: {
    Search: ({ placeholder, value, onChange, onFocus }: {
      placeholder?: string;
      value?: string;
      onChange: (event: { target: { value: string } }) => void;
      onFocus?: () => void;
    }) => (
      <input
        aria-label={placeholder ?? "search-location"}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
      />
    ),
  },
  List: Object.assign(
    ({ dataSource, renderItem }: { dataSource: Array<{ place_id?: number; display_name?: string }>; renderItem: (item: { place_id?: number; display_name?: string }) => React.ReactNode }) => (
      <div>{dataSource.map((item) => <div key={String(item.place_id ?? item.display_name)}>{renderItem(item)}</div>)}</div>
    ),
    {
      Item: ({ children, onClick, onKeyDown, ...props }: { children: React.ReactNode; onClick?: () => void; onKeyDown?: (event: { key: string; preventDefault: () => void }) => void }) => (
        <button
          type="button"
          onClick={onClick}
          onKeyDown={() => onKeyDown?.({ key: "Enter", preventDefault() {} })}
          {...props}
        >
          {children}
        </button>
      ),
    }
  ),
  Typography: {
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  },
  Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  message: {
    error: mocks.messageError,
  },
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ center, children }: { center: [number, number]; children: React.ReactNode }) => (
    <div>
      <div data-testid="map-center">{`${center[0]},${center[1]}`}</div>
      {children}
    </div>
  ),
  TileLayer: () => <div>tile-layer</div>,
  Marker: ({ eventHandlers }: { eventHandlers?: { dragend?: (event: { target: { getLatLng: () => { lat: number; lng: number } } }) => void } }) => (
    <button
      type="button"
      onClick={() =>
        eventHandlers?.dragend?.({
          target: {
            getLatLng: () => ({ lat: mocks.markerPosition.lat, lng: mocks.markerPosition.lng }),
          },
        })
      }
    >
      drag-marker
    </button>
  ),
  useMap: () => ({
    flyTo: mocks.flyTo,
    on: mocks.on,
    off: mocks.off,
  }),
}));

vi.mock("leaflet", () => ({
  Icon: class {},
}));

describe("MapLocationPicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.translate.mockClear();
    mocks.messageError.mockReset();
    mocks.flyTo.mockReset();
    mocks.on.mockReset();
    mocks.off.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses provided coordinates as the initial map center", () => {
    render(<MapLocationPicker latitude="-7.123" longitude="110.456" />);

    expect(screen.getByTestId("map-center").textContent).toBe("-7.123,110.456");
  });

  it("selects a searched location and reports normalized coordinates", async () => {
    const onLocationChange = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            place_id: 1,
            display_name: "Jakarta Selatan",
            lat: "-6.2",
            lon: "106.8",
            type: "city",
            class: "boundary",
            importance: 0.8,
          },
        ],
      })
    );

    render(<MapLocationPicker onLocationChange={onLocationChange} />);

    fireEvent.change(screen.getByLabelText("Cari apotek, klinik, kecamatan, atau lokasi..."), {
      target: { value: "jakarta" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    fireEvent.click(screen.getByRole("button", { name: "Pilih Jakarta Selatan" }));

    expect(onLocationChange).toHaveBeenCalledWith("-6.200000", "106.800000");
    expect(mocks.flyTo).toHaveBeenCalledWith([-6.2, 106.8], 16, { duration: 1.5 });
  });

  it("updates location when the marker drag ends", () => {
    const onLocationChange = vi.fn();

    render(<MapLocationPicker onLocationChange={onLocationChange} />);

    fireEvent.click(screen.getByRole("button", { name: "drag-marker" }));

    expect(onLocationChange).toHaveBeenCalledWith("-6.300000", "106.900000");
  });

  it("shows an error when location search fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      })
    );

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      render(<MapLocationPicker />);

      fireEvent.change(screen.getByLabelText("Cari apotek, klinik, kecamatan, atau lokasi..."), {
        target: { value: "bandung" },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Nominatim search error:",
        expect.any(Error),
      );
      expect(mocks.messageError).toHaveBeenCalledWith("Gagal mencari lokasi. Silakan coba lagi.");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
