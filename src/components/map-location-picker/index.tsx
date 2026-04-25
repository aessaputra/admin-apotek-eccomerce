import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, AutoComplete, Space, Spin, Typography, theme } from "antd";
import { useTranslation } from "@refinedev/core";
import {
  APIProvider,
  Map,
  Marker,
  type MapMouseEvent,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";

export interface MapLocationPickerProps {
  latitude?: string | number;
  longitude?: string | number;
  onLocationChange?: (lat: string, lng: string) => void;
  height?: string;
}

const DEFAULT_LAT = -6.2088;
const DEFAULT_LNG = 106.8456;
const DEFAULT_ZOOM = 13;
const MIN_SEARCH_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 400;
const INDONESIA_REGION_CODE = "id";

type PlacesErrorKey = "missingGeometry" | "searchError" | null;

type Coordinate = {
  lat: number;
  lng: number;
};

type GoogleLatLngValue = {
  lat?: number | (() => number);
  lng?: number | (() => number);
};

type AutocompleteSessionToken = object;

type PlaceDetails = {
  fetchFields?: (request: { fields: string[] }) => Promise<unknown>;
  location?: GoogleLatLngValue | null;
};

type PlacePrediction = {
  text?: string | { toString: () => string };
  mainText?: string | { toString: () => string };
  secondaryText?: string | { toString: () => string };
  toPlace?: () => PlaceDetails;
};

type PlaceSuggestion = {
  placePrediction?: PlacePrediction;
};

type PlacesAutocompleteRequest = {
  input: string;
  includedRegionCodes: string[];
  sessionToken?: AutocompleteSessionToken;
};

type PlacesLibrary = {
  AutocompleteSuggestion?: {
    fetchAutocompleteSuggestions?: (
      request: PlacesAutocompleteRequest,
    ) => Promise<{ suggestions?: PlaceSuggestion[] }>;
  };
  AutocompleteSessionToken?: new () => AutocompleteSessionToken;
};

type PlaceAutocompleteOption = {
  value: string;
  label: ReactNode;
  prediction: PlacePrediction;
};

type MarkerDragEvent = {
  latLng?: {
    lat: () => number;
    lng: () => number;
  } | null;
};

function toFiniteCoordinate(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const coordinate = typeof value === "number" ? value : Number(value);

  return Number.isFinite(coordinate) ? coordinate : null;
}

function formatCoordinate(value: number): string {
  return value.toFixed(6);
}

function readPlacesText(value: PlacePrediction["text"]): string | null {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.toString();
}

function hasValidCoordinates(coordinate: {
  lat: number | null;
  lng: number | null;
}): coordinate is Coordinate {
  return Number.isFinite(coordinate.lat) && Number.isFinite(coordinate.lng);
}

function getInitialPosition(
  latitude: string | number | undefined,
  longitude: string | number | undefined,
): Coordinate {
  const lat = toFiniteCoordinate(latitude);
  const lng = toFiniteCoordinate(longitude);

  const coordinate = { lat, lng };

  if (hasValidCoordinates(coordinate)) {
    return coordinate;
  }

  return { lat: DEFAULT_LAT, lng: DEFAULT_LNG };
}

function getGoogleEventCoordinates(event: MarkerDragEvent): Coordinate | null {
  const latLng = event.latLng;

  if (!latLng) {
    return null;
  }

  const lat = latLng.lat();
  const lng = latLng.lng();

  const coordinate = { lat, lng };

  return hasValidCoordinates(coordinate) ? coordinate : null;
}

function getMapEventCoordinates(event: MapMouseEvent): Coordinate | null {
  const latLng = event.detail.latLng;

  if (!latLng) {
    return null;
  }

  const lat = toFiniteCoordinate(latLng.lat);
  const lng = toFiniteCoordinate(latLng.lng);

  const coordinate = { lat, lng };

  return hasValidCoordinates(coordinate) ? coordinate : null;
}

function getPlaceCoordinates(place: PlaceDetails): Coordinate | null {
  const latValue = place.location?.lat;
  const lngValue = place.location?.lng;
  const lat = typeof latValue === "function" ? latValue() : latValue;
  const lng = typeof lngValue === "function" ? lngValue() : lngValue;
  const coordinate = {
    lat: toFiniteCoordinate(lat),
    lng: toFiniteCoordinate(lng),
  };

  return hasValidCoordinates(coordinate) ? coordinate : null;
}

function getPredictionText(prediction: PlacePrediction): string {
  return (
    readPlacesText(prediction.text) ??
    readPlacesText(prediction.mainText) ??
    "Google Places result"
  );
}

function renderPredictionLabel(prediction: PlacePrediction): ReactNode {
  const mainText =
    readPlacesText(prediction.mainText) ?? getPredictionText(prediction);
  const secondaryText = readPlacesText(prediction.secondaryText);

  return (
    <Space direction="vertical" size={0}>
      <Typography.Text>{mainText}</Typography.Text>
      {secondaryText ? (
        <Typography.Text type="secondary">{secondaryText}</Typography.Text>
      ) : null}
    </Space>
  );
}

const PlacesAutocomplete: React.FC<{
  onPlaceSelect: (coordinate: Coordinate | null) => void;
}> = ({ onPlaceSelect }) => {
  const { translate } = useTranslation();
  const placesLibrary = useMapsLibrary("places") as PlacesLibrary | null;
  const [searchText, setSearchText] = useState("");
  const [options, setOptions] = useState<PlaceAutocompleteOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<PlacesErrorKey>(null);
  const sessionTokenRef = useRef<AutocompleteSessionToken | null>(null);

  const fetchAutocompleteSuggestions =
    placesLibrary?.AutocompleteSuggestion?.fetchAutocompleteSuggestions;
  const isPlacesReady = Boolean(fetchAutocompleteSuggestions);
  const visibleErrorKey = isPlacesReady ? errorKey : "placesUnavailable";

  const getSessionToken = useCallback(() => {
    if (!placesLibrary?.AutocompleteSessionToken) {
      return undefined;
    }

    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new placesLibrary.AutocompleteSessionToken();
    }

    return sessionTokenRef.current;
  }, [placesLibrary]);

  const resetSessionToken = useCallback(() => {
    sessionTokenRef.current = null;
  }, []);

  useEffect(() => {
    const query = searchText.trim();

    if (query.length < MIN_SEARCH_LENGTH || !fetchAutocompleteSuggestions) {
      setOptions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(() => {
      setLoading(true);

      void fetchAutocompleteSuggestions({
        input: query,
        includedRegionCodes: [INDONESIA_REGION_CODE],
        sessionToken: getSessionToken(),
      })
        .then((response) => {
          if (cancelled) {
            return;
          }

          const nextOptions = (response.suggestions ?? []).flatMap(
            (suggestion, index): PlaceAutocompleteOption[] => {
              const prediction = suggestion.placePrediction;

              if (!prediction) {
                return [];
              }

              return [
                {
                  value: `${index}-${getPredictionText(prediction)}`,
                  label: renderPredictionLabel(prediction),
                  prediction,
                },
              ];
            },
          );

          setOptions(nextOptions);
          setErrorKey(null);
        })
        .catch(() => {
          if (!cancelled) {
            setOptions([]);
            setErrorKey("searchError");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [fetchAutocompleteSuggestions, getSessionToken, searchText]);

  const handleSearch = (value: string) => {
    setSearchText(value);
    setErrorKey(null);

    if (value.trim().length < MIN_SEARCH_LENGTH) {
      setOptions([]);
    }
  };

  const handleSelect = async (
    _value: string,
    option: PlaceAutocompleteOption,
  ) => {
    const place = option.prediction.toPlace?.();

    if (!place) {
      setErrorKey("missingGeometry");
      resetSessionToken();
      return;
    }

    try {
      await place.fetchFields?.({ fields: ["location"] });
    } catch {
      setErrorKey("searchError");
      resetSessionToken();
      return;
    }

    const nextCoordinate = getPlaceCoordinates(place);

    if (!nextCoordinate) {
      setErrorKey("missingGeometry");
      resetSessionToken();
      return;
    }

    setSearchText(getPredictionText(option.prediction));
    setOptions([]);
    setErrorKey(null);
    resetSessionToken();
    onPlaceSelect(nextCoordinate);
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <AutoComplete
        value={searchText}
        options={options}
        onSearch={handleSearch}
        onSelect={(value, option) =>
          void handleSelect(value, option as PlaceAutocompleteOption)
        }
        placeholder={translate(
          "settings.mapLocationPicker.searchPlaceholder",
          {},
          "Search pharmacy, clinic, district, or location...",
        )}
        notFoundContent={
          loading ? (
            <Spin size="small" />
          ) : (
            translate(
              "settings.mapLocationPicker.noPlacesFound",
              {},
              "No places found",
            )
          )
        }
        disabled={!isPlacesReady}
        filterOption={false}
        style={{ width: "100%" }}
      />
      {visibleErrorKey ? (
        <Alert
          type="warning"
          showIcon
          message={translate(
            `settings.mapLocationPicker.${visibleErrorKey}`,
            {},
            visibleErrorKey === "missingGeometry"
              ? "Selected place does not include map coordinates. Please choose another result or click the map."
              : visibleErrorKey === "searchError"
                ? "Failed to search Google Places. Please try again."
                : "Google Places search is unavailable right now. You can still click the map or drag the pin.",
          )}
        />
      ) : null}
    </Space>
  );
};

export const MapLocationPicker: React.FC<MapLocationPickerProps> = ({
  latitude,
  longitude,
  onLocationChange,
  height = "300px",
}) => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const initialPosition = useMemo(
    () => getInitialPosition(latitude, longitude),
    [latitude, longitude],
  );
  const [position, setPosition] = useState<Coordinate>(initialPosition);

  useEffect(() => {
    setPosition(initialPosition);
  }, [initialPosition]);

  const updateLocation = useCallback(
    (nextPosition: Coordinate | null) => {
      if (!nextPosition) {
        return;
      }

      setPosition(nextPosition);
      onLocationChange?.(
        formatCoordinate(nextPosition.lat),
        formatCoordinate(nextPosition.lng),
      );
    },
    [onLocationChange],
  );

  const handleMapClick = useCallback(
    (event: MapMouseEvent) => {
      updateLocation(getMapEventCoordinates(event));
    },
    [updateLocation],
  );

  const handleMarkerDragEnd = useCallback(
    (event: MarkerDragEvent) => {
      updateLocation(getGoogleEventCoordinates(event));
    },
    [updateLocation],
  );

  if (!apiKey) {
    return (
      <Alert
        type="warning"
        showIcon
        message={translate(
          "settings.mapLocationPicker.missingApiKeyTitle",
          {},
          "Google Maps API key is not configured",
        )}
        description={translate(
          "settings.mapLocationPicker.missingApiKeyDescription",
          {},
          "Set VITE_GOOGLE_MAPS_API_KEY to enable store location picking.",
        )}
      />
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <APIProvider apiKey={apiKey} libraries={["places"]}>
        <Space direction="vertical" style={{ width: "100%", marginBottom: token.marginSM }}>
          <PlacesAutocomplete onPlaceSelect={updateLocation} />
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {translate(
              "settings.mapLocationPicker.interactionHint",
              {},
              "Click on the map or drag the pin to choose a precise location.",
            )}
          </Typography.Text>
        </Space>

        <div
          style={{
            height,
            width: "100%",
            borderRadius: token.borderRadiusLG,
            overflow: "hidden",
            border: `1px solid ${token.colorBorder}`,
          }}
        >
          <Map
            center={position}
            defaultCenter={initialPosition}
            zoom={DEFAULT_ZOOM}
            defaultZoom={DEFAULT_ZOOM}
            style={{ height: "100%", width: "100%" }}
            gestureHandling="greedy"
            onClick={handleMapClick}
          >
            <Marker
              position={position}
              draggable
              onDragEnd={handleMarkerDragEnd}
            />
          </Map>
        </div>
      </APIProvider>
    </div>
  );
};

export default MapLocationPicker;
