import { useState, useEffect, useCallback, useRef, memo } from "react";
import { Input, List, Typography, Space, Spin, type InputRef } from "antd";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
  type MapMouseEvent,
} from "@vis.gl/react-google-maps";

interface PlaceSuggestion {
  placePrediction: google.maps.places.PlacePrediction;
}

interface AutocompleteSuggestionResult {
  placePrediction?: google.maps.places.PlacePrediction;
}

interface SuggestionListProps {
  suggestions: PlaceSuggestion[];
  onSelect: (suggestion: PlaceSuggestion) => void;
}

const SuggestionList = memo<SuggestionListProps>(function SuggestionList({
  suggestions,
  onSelect,
}) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <List
      size="small"
      bordered
      dataSource={suggestions}
      renderItem={(item) => (
        <List.Item
          key={item.placePrediction.placeId}
          style={{ cursor: "pointer", padding: "8px 12px" }}
          onClick={() => onSelect(item)}
        >
          <Typography.Text style={{ fontSize: "12px", lineHeight: "1.4" }}>
            {item.placePrediction.text.text}
          </Typography.Text>
        </List.Item>
      )}
      style={{ maxHeight: "250px", overflow: "auto", marginTop: "8px" }}
    />
  );
});

interface GooglePlacesAutocompleteProps {
  onPlaceSelect: (lat: number, lng: number, address: string) => void;
}

const GooglePlacesAutocomplete: React.FC<GooglePlacesAutocompleteProps> = ({
  onPlaceSelect,
}) => {
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearchValue, setDebouncedSearchValue] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const placesLib = useMapsLibrary("places");
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const requestIdRef = useRef(0);
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchValue(searchValue.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchValue]);

  useEffect(() => {
    if (!placesLib) {
      return;
    }

    if (debouncedSearchValue === "") {
      requestIdRef.current += 1;
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const currentRequestId = requestIdRef.current + 1;
    requestIdRef.current = currentRequestId;
    setIsLoading(true);

    const fetchSuggestions = async () => {
      const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;

      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new AutocompleteSessionToken();
      }

      try {
        const request: google.maps.places.AutocompleteRequest = {
          input: debouncedSearchValue,
          inputOffset: debouncedSearchValue.length,
          sessionToken: sessionTokenRef.current,
          includedRegionCodes: ["ID"],
          language: "id",
          region: "id",
        };

        const response = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

        if (requestIdRef.current !== currentRequestId) {
          return;
        }

        const placeSuggestions = response.suggestions
          .map((suggestion) => (suggestion as AutocompleteSuggestionResult).placePrediction)
          .filter(
            (placePrediction): placePrediction is google.maps.places.PlacePrediction =>
              Boolean(placePrediction)
          )
          .map((placePrediction) => ({ placePrediction }));

        setSuggestions(placeSuggestions);
      } catch (error) {
        if (requestIdRef.current === currentRequestId) {
          console.error("Places API error:", error);
          setSuggestions([]);
        }
      } finally {
        if (requestIdRef.current === currentRequestId) {
          setIsLoading(false);
        }
      }
    };

    void fetchSuggestions();
  }, [debouncedSearchValue, placesLib]);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSearchValue(event.target.value);
    },
    []
  );

  const handleSuggestionSelect = useCallback(
    async (suggestion: PlaceSuggestion) => {
      const place = suggestion.placePrediction.toPlace();

      await place.fetchFields({
        fields: ["location", "formattedAddress"],
      });

      const lat = place.location?.lat();
      const lng = place.location?.lng();
      const address = place.formattedAddress ?? suggestion.placePrediction.text.text;

      if (lat === undefined || lng === undefined) {
        return;
      }

      onPlaceSelect(lat, lng, address);
      sessionTokenRef.current = null;
      requestIdRef.current += 1;
      setSearchValue(address);
      setDebouncedSearchValue("");
      setSuggestions([]);
      setIsLoading(false);

      // Restore focus to input after selection
      inputRef.current?.focus();
    },
    [onPlaceSelect]
  );

  const suffix = <span>{isLoading ? <Spin size="small" /> : null}</span>;

  return (
    <div style={{ width: "100%" }}>
      <Input
        ref={inputRef}
        placeholder="Cari apotek, klinik, atau lokasi..."
        value={searchValue}
        onChange={handleInputChange}
        suffix={suffix}
        autoComplete="off"
        spellCheck={false}
      />
      <SuggestionList suggestions={suggestions} onSelect={handleSuggestionSelect} />
    </div>
  );
};

export interface MapLocationPickerProps {
  latitude?: string | number;
  longitude?: string | number;
  onLocationChange?: (lat: string, lng: string) => void;
  height?: string;
}

const DEFAULT_LAT = -6.2088;
const DEFAULT_LNG = 106.8456;

interface MapControllerProps {
  lat: number;
  lng: number;
  zoom?: number;
}

const MapController: React.FC<MapControllerProps> = ({ lat, lng, zoom }) => {
  const map = useMap();

  useEffect(() => {
    if (!map) {
      return;
    }

    map.panTo({ lat, lng });

    if (zoom !== undefined) {
      map.setZoom(zoom);
    }
  }, [map, lat, lng, zoom]);

  return null;
};

const MapLocationPickerInner: React.FC<MapLocationPickerProps> = ({
  latitude,
  longitude,
  onLocationChange,
  height = "300px",
}) => {
  const [position, setPosition] = useState<{ lat: number; lng: number }>(() => {
    const lat =
      typeof latitude === "string"
        ? parseFloat(latitude) || DEFAULT_LAT
        : latitude ?? DEFAULT_LAT;
    const lng =
      typeof longitude === "string"
        ? parseFloat(longitude) || DEFAULT_LNG
        : longitude ?? DEFAULT_LNG;

    return { lat, lng };
  });
  const [zoom, setZoom] = useState(13);

  useEffect(() => {
    const lat =
      typeof latitude === "string"
        ? parseFloat(latitude) || DEFAULT_LAT
        : latitude ?? DEFAULT_LAT;
    const lng =
      typeof longitude === "string"
        ? parseFloat(longitude) || DEFAULT_LNG
        : longitude ?? DEFAULT_LNG;

    setPosition({ lat, lng });
  }, [latitude, longitude]);

  const handleMapClick = useCallback(
    (event: MapMouseEvent) => {
      const { latLng } = event.detail;

      if (!latLng) {
        return;
      }

      setPosition(latLng);
      onLocationChange?.(latLng.lat.toFixed(6), latLng.lng.toFixed(6));
    },
    [onLocationChange]
  );

  const handleMarkerDragEnd = useCallback(
    (event: google.maps.MapMouseEvent) => {
      const latLng = event.latLng;

      if (!latLng) {
        return;
      }

      const nextPosition = {
        lat: latLng.lat(),
        lng: latLng.lng(),
      };

      setPosition(nextPosition);
      onLocationChange?.(nextPosition.lat.toFixed(6), nextPosition.lng.toFixed(6));
    },
    [onLocationChange]
  );

  const handlePlaceSelect = useCallback(
    (lat: number, lng: number) => {
      setPosition({ lat, lng });
      setZoom(16);
      onLocationChange?.(lat.toFixed(6), lng.toFixed(6));
    },
    [onLocationChange]
  );

  return (
    <div style={{ width: "100%" }}>
      <Space direction="vertical" style={{ width: "100%", marginBottom: 12 }}>
        <GooglePlacesAutocomplete onPlaceSelect={handlePlaceSelect} />
        <Typography.Text type="secondary" style={{ fontSize: "12px" }}>
          Atau klik langsung pada peta untuk memilih lokasi
        </Typography.Text>
      </Space>
      <div style={{ height, width: "100%", borderRadius: "8px", overflow: "hidden" }}>
        <GoogleMap
          defaultCenter={position}
          defaultZoom={zoom}
          center={position}
          zoom={zoom}
          gestureHandling="greedy"
          disableDefaultUI={false}
          mapId="map-location-picker"
          onClick={handleMapClick}
        >
          <MapController lat={position.lat} lng={position.lng} zoom={zoom} />
          <AdvancedMarker position={position} draggable={true} onDragEnd={handleMarkerDragEnd} />
        </GoogleMap>
      </div>
    </div>
  );
};

export const MapLocationPicker: React.FC<MapLocationPickerProps> = (props) => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.error("VITE_GOOGLE_MAPS_API_KEY is not defined in environment variables");

    return (
      <div style={{ padding: "20px", color: "red" }}>
        Google Maps API Key tidak dikonfigurasi. Silakan hubungi administrator.
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey} version="beta">
      <MapLocationPickerInner {...props} />
    </APIProvider>
  );
};

export default MapLocationPicker;
