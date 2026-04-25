import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapLocationPicker from "..";

const mocks = vi.hoisted(() => {
  const mapRender = vi.fn();
  const markerRender = vi.fn();
  const translate = vi.fn(
    (key: string, _params?: Record<string, unknown>, fallback?: string) => {
      const translations: Record<string, string> = {
        "settings.mapLocationPicker.interactionHint":
          "Atau klik pada peta atau seret pin untuk memilih lokasi yang lebih presisi.",
        "settings.mapLocationPicker.missingApiKeyTitle":
          "Google Maps API key is not configured",
        "settings.mapLocationPicker.missingApiKeyDescription":
          "Set VITE_GOOGLE_MAPS_API_KEY to enable store location picking.",
        "settings.mapLocationPicker.searchPlaceholder":
          "Search pharmacy, clinic, district, or location...",
        "settings.mapLocationPicker.noPlacesFound": "No places found",
        "settings.mapLocationPicker.placesUnavailable":
          "Google Places search is unavailable right now. You can still click the map or drag the pin.",
        "settings.mapLocationPicker.searchError":
          "Failed to search Google Places. Please try again.",
        "settings.mapLocationPicker.missingGeometry":
          "Selected place does not include map coordinates. Please choose another result or click the map.",
      };

      return translations[key] ?? fallback ?? key;
    },
  );
  const fetchAutocompleteSuggestions = vi.fn();
  const AutocompleteSessionToken = vi.fn(function AutocompleteSessionToken() {
    return { session: "test-session-token" };
  });
  const useMapsLibrary = vi.fn();
  const createSuggestion = (
    mainText: string,
    secondaryText: string,
    location: { lat: () => number; lng: () => number } | null,
    fetchFieldsImplementation: () => Promise<unknown> = async () => undefined,
  ) => {
    const fetchFields = vi.fn(fetchFieldsImplementation);
    const place = { fetchFields, location };
    const toPlace = vi.fn(() => place);

    return {
      fetchFields,
      place,
      suggestion: {
        placePrediction: {
          text: { toString: () => `${mainText}, ${secondaryText}` },
          mainText: { toString: () => mainText },
          secondaryText: { toString: () => secondaryText },
          toPlace,
        },
      },
      toPlace,
    };
  };
  const placesLibrary = {
    AutocompleteSuggestion: { fetchAutocompleteSuggestions },
    AutocompleteSessionToken,
  };

  return {
    AutocompleteSessionToken,
    createSuggestion,
    fetchAutocompleteSuggestions,
    mapClickPosition: { lat: -6.1754, lng: 106.8272 },
    markerDragPosition: { lat: -6.3, lng: 106.9 },
    mapRender,
    markerRender,
    placesLibrary: placesLibrary as typeof placesLibrary | null,
    translate,
    useMapsLibrary,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("antd", () => ({
  Alert: ({ message, description }: { message?: React.ReactNode; description?: React.ReactNode }) => (
    <div role="alert">
      <strong>{message}</strong>
      <span>{description}</span>
    </div>
  ),
  AutoComplete: ({
    disabled,
    notFoundContent,
    onSearch,
    onSelect,
    options = [],
    placeholder,
    value,
  }: {
    disabled?: boolean;
    notFoundContent?: React.ReactNode;
    onSearch?: (value: string) => void;
    onSelect?: (value: string, option: unknown) => void;
    options?: { value: string; label: React.ReactNode }[];
    placeholder?: string;
    value?: string;
  }) => (
    <div>
      <input
        aria-label={placeholder}
        disabled={disabled}
        onChange={(event) => onSearch?.(event.target.value)}
        placeholder={placeholder}
        value={value ?? ""}
      />
      {options.length === 0 ? (
        <div data-testid="autocomplete-not-found">{notFoundContent}</div>
      ) : (
        <div data-testid="autocomplete-options">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect?.(option.value, option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  ),
  Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Spin: () => <span>loading</span>,
  Typography: {
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  },
  theme: {
    useToken: () => ({
      token: {
        borderRadiusLG: 8,
        colorBorder: "#d9d9d9",
        fontSizeSM: 12,
        marginSM: 12,
      },
    }),
  },
}));

vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({
    apiKey,
    children,
    libraries,
  }: {
    apiKey: string;
    children: React.ReactNode;
    libraries?: string[];
  }) => (
    <div
      data-testid="api-provider"
      data-api-key={apiKey}
      data-libraries={libraries?.join(",") ?? ""}
    >
      {children}
    </div>
  ),
  Map: ({ center, defaultCenter, children, onClick }: {
    center: { lat: number; lng: number };
    defaultCenter: { lat: number; lng: number };
    children: React.ReactNode;
    onClick?: (event: { detail: { latLng: { lat: number; lng: number } | null } }) => void;
  }) => {
    mocks.mapRender({ center, defaultCenter });

    return (
      <div data-testid="google-map">
        <div data-testid="map-center">{`${center.lat},${center.lng}`}</div>
        <div data-testid="map-default-center">{`${defaultCenter.lat},${defaultCenter.lng}`}</div>
        <button
          type="button"
          onClick={() => onClick?.({ detail: { latLng: mocks.mapClickPosition } })}
        >
          click-map
        </button>
        <button
          type="button"
          onClick={() => onClick?.({ detail: { latLng: null } })}
        >
          click-map-null
        </button>
        {children}
      </div>
    );
  },
  Marker: ({ position, draggable, onDragEnd }: {
    position: { lat: number; lng: number };
    draggable?: boolean;
    onDragEnd?: (event: { latLng: { lat: () => number; lng: () => number } | null }) => void;
  }) => {
    mocks.markerRender({ draggable, position });

    return (
      <div>
        <div data-testid="marker-position">{`${position.lat},${position.lng}`}</div>
        <div data-testid="marker-draggable">{String(Boolean(draggable))}</div>
        <button
          type="button"
          onClick={() => onDragEnd?.({
            latLng: {
              lat: () => mocks.markerDragPosition.lat,
              lng: () => mocks.markerDragPosition.lng,
            },
          })}
        >
          drag-marker
        </button>
        <button
          type="button"
          onClick={() => onDragEnd?.({ latLng: null })}
        >
          drag-marker-null
        </button>
      </div>
    );
  },
  useMapsLibrary: (name: string) => {
    mocks.useMapsLibrary(name);
    return mocks.placesLibrary;
  },
}));

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

async function runDebouncedPlaceSearch(query: string) {
  fireEvent.change(
    screen.getByPlaceholderText("Search pharmacy, clinic, district, or location..."),
    { target: { value: query } },
  );

  await act(async () => {
    vi.advanceTimersByTime(450);
    await flushAsyncWork();
  });
}

describe("MapLocationPicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-google-key");
    mocks.AutocompleteSessionToken.mockClear();
    mocks.fetchAutocompleteSuggestions.mockReset();
    mocks.fetchAutocompleteSuggestions.mockResolvedValue({ suggestions: [] });
    mocks.mapRender.mockClear();
    mocks.markerRender.mockClear();
    mocks.placesLibrary = {
      AutocompleteSuggestion: {
        fetchAutocompleteSuggestions: mocks.fetchAutocompleteSuggestions,
      },
      AutocompleteSessionToken: mocks.AutocompleteSessionToken,
    };
    mocks.translate.mockClear();
    mocks.useMapsLibrary.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("shows a recoverable alert and does not instantiate the map when the API key is missing", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");

    render(<MapLocationPicker />);

    expect(screen.getByRole("alert").textContent).toContain("Google Maps API key is not configured");
    expect(screen.queryByTestId("google-map")).toBeNull();
    expect(mocks.mapRender).not.toHaveBeenCalled();
  });

  it("uses valid initial coordinates for the map center and draggable marker", () => {
    render(<MapLocationPicker latitude="-7.123" longitude="110.456" />);

    expect(screen.getByTestId("api-provider").getAttribute("data-api-key")).toBe("test-google-key");
    expect(screen.getByTestId("api-provider").getAttribute("data-libraries")).toBe("places");
    expect(mocks.useMapsLibrary).toHaveBeenCalledWith("places");
    expect(screen.getByTestId("map-center").textContent).toBe("-7.123,110.456");
    expect(screen.getByTestId("map-default-center").textContent).toBe("-7.123,110.456");
    expect(screen.getByTestId("marker-position").textContent).toBe("-7.123,110.456");
    expect(screen.getByTestId("marker-draggable").textContent).toBe("true");
  });

  it("falls back to Jakarta when initial coordinates are invalid", () => {
    render(<MapLocationPicker latitude="not-a-number" longitude={Number.NaN} />);

    expect(screen.getByTestId("map-center").textContent).toBe("-6.2088,106.8456");
    expect(screen.getByTestId("marker-position").textContent).toBe("-6.2088,106.8456");
  });

  it("updates the marker and reports 6-decimal strings after a Google Places result with geometry is selected", async () => {
    const onLocationChange = vi.fn();
    const suggestion = mocks.createSuggestion("Monas", "Jakarta Pusat", {
      lat: () => -6.175392,
      lng: () => 106.827153,
    });
    mocks.fetchAutocompleteSuggestions.mockResolvedValue({
      suggestions: [suggestion.suggestion],
    });

    render(<MapLocationPicker onLocationChange={onLocationChange} />);

    await runDebouncedPlaceSearch("monas");

    expect(mocks.fetchAutocompleteSuggestions).toHaveBeenCalledWith({
      input: "monas",
      includedRegionCodes: ["id"],
      sessionToken: { session: "test-session-token" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Monas/ }));

    await act(async () => {
      await flushAsyncWork();
    });

    expect(suggestion.fetchFields).toHaveBeenCalledWith({ fields: ["location"] });
    expect(screen.getByTestId("map-center").textContent).toBe("-6.175392,106.827153");
    expect(screen.getByTestId("marker-position").textContent).toBe("-6.175392,106.827153");
    expect(onLocationChange).toHaveBeenCalledWith("-6.175392", "106.827153");
  });

  it("shows a recoverable error and keeps coordinates unchanged when a Google Places result has no geometry", async () => {
    const onLocationChange = vi.fn();
    const suggestion = mocks.createSuggestion("Unknown Place", "Indonesia", null);
    mocks.fetchAutocompleteSuggestions.mockResolvedValue({
      suggestions: [suggestion.suggestion],
    });

    render(<MapLocationPicker onLocationChange={onLocationChange} />);

    await runDebouncedPlaceSearch("unknown place");
    fireEvent.click(screen.getByRole("button", { name: /Unknown Place/ }));

    await act(async () => {
      await flushAsyncWork();
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "Selected place does not include map coordinates",
    );
    expect(screen.getByTestId("map-center").textContent).toBe("-6.2088,106.8456");
    expect(screen.getByTestId("marker-position").textContent).toBe("-6.2088,106.8456");
    expect(onLocationChange).not.toHaveBeenCalled();
  });

  it("shows a recoverable search error and keeps coordinates unchanged when Google Places detail loading fails", async () => {
    const onLocationChange = vi.fn();
    const suggestion = mocks.createSuggestion(
      "Monas Detail Error",
      "Jakarta Pusat",
      {
        lat: () => -6.175392,
        lng: () => 106.827153,
      },
      async () => {
        throw new Error("Places detail failure");
      },
    );
    mocks.fetchAutocompleteSuggestions.mockResolvedValue({
      suggestions: [suggestion.suggestion],
    });

    render(<MapLocationPicker onLocationChange={onLocationChange} />);

    await runDebouncedPlaceSearch("monas detail error");
    fireEvent.click(screen.getByRole("button", { name: /Monas Detail Error/ }));

    await act(async () => {
      await flushAsyncWork();
    });

    expect(suggestion.fetchFields).toHaveBeenCalledWith({ fields: ["location"] });
    expect(screen.getByRole("alert").textContent).toContain(
      "Failed to search Google Places. Please try again.",
    );
    expect(screen.getByTestId("map-center").textContent).toBe("-6.2088,106.8456");
    expect(screen.getByTestId("marker-position").textContent).toBe("-6.2088,106.8456");
    expect(onLocationChange).not.toHaveBeenCalled();
  });

  it("shows a recoverable Places unavailable message while keeping map click selection usable", () => {
    const onLocationChange = vi.fn();
    mocks.placesLibrary = null;

    render(<MapLocationPicker onLocationChange={onLocationChange} />);

    expect(screen.getByRole("alert").textContent).toContain(
      "Google Places search is unavailable right now",
    );
    expect(
      (screen.getByPlaceholderText("Search pharmacy, clinic, district, or location...") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("google-map")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "click-map" }));

    expect(onLocationChange).toHaveBeenCalledWith("-6.175400", "106.827200");
  });

  it("updates the marker and reports 6-decimal strings after a map click", () => {
    const onLocationChange = vi.fn();

    render(<MapLocationPicker onLocationChange={onLocationChange} />);

    fireEvent.click(screen.getByRole("button", { name: "click-map" }));

    expect(screen.getByTestId("map-center").textContent).toBe("-6.1754,106.8272");
    expect(screen.getByTestId("marker-position").textContent).toBe("-6.1754,106.8272");
    expect(onLocationChange).toHaveBeenCalledWith("-6.175400", "106.827200");
  });

  it("updates the marker and reports 6-decimal strings after marker drag", () => {
    const onLocationChange = vi.fn();

    render(<MapLocationPicker onLocationChange={onLocationChange} />);

    fireEvent.click(screen.getByRole("button", { name: "drag-marker" }));

    expect(screen.getByTestId("map-center").textContent).toBe("-6.3,106.9");
    expect(screen.getByTestId("marker-position").textContent).toBe("-6.3,106.9");
    expect(onLocationChange).toHaveBeenCalledWith("-6.300000", "106.900000");
  });

  it("ignores map clicks without a latLng payload", () => {
    const onLocationChange = vi.fn();

    render(<MapLocationPicker onLocationChange={onLocationChange} />);

    fireEvent.click(screen.getByRole("button", { name: "click-map-null" }));

    expect(screen.getByTestId("map-center").textContent).toBe("-6.2088,106.8456");
    expect(onLocationChange).not.toHaveBeenCalled();
  });

  it("ignores marker drags without a latLng payload", () => {
    const onLocationChange = vi.fn();

    render(<MapLocationPicker onLocationChange={onLocationChange} />);

    fireEvent.click(screen.getByRole("button", { name: "drag-marker-null" }));

    expect(screen.getByTestId("marker-position").textContent).toBe("-6.2088,106.8456");
    expect(onLocationChange).not.toHaveBeenCalled();
  });
});
