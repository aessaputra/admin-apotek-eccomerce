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

interface SuggestionListProps {
  suggestions: google.maps.places.AutocompletePrediction[];
  onSelect: (suggestion: google.maps.places.AutocompletePrediction) => void;
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
          key={item.place_id}
          style={{ cursor: "pointer", padding: "8px 12px" }}
          onClick={() => onSelect(item)}
        >
          <Typography.Text style={{ fontSize: "12px", lineHeight: "1.4" }}>
            {item.description}
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
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const placesLib = useMapsLibrary("places");
  const geocodingLib = useMapsLibrary("geocoding");
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const requestIdRef = useRef(0);
  const inputRef = useRef<InputRef>(null);

  // Initialize AutocompleteService when places library loads
  useEffect(() => {
    if (placesLib && !autocompleteServiceRef.current) {
      autocompleteServiceRef.current = new placesLib.AutocompleteService();
    }
  }, [placesLib]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchValue(searchValue.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchValue]);

  useEffect(() => {
    if (!placesLib || !autocompleteServiceRef.current) {
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
      const { AutocompleteSessionToken } = placesLib;

      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new AutocompleteSessionToken();
      }

      try {
        const request: google.maps.places.AutocompletionRequest = {
          input: debouncedSearchValue,
          sessionToken: sessionTokenRef.current,
          componentRestrictions: { country: "id" },
        };

        const service = autocompleteServiceRef.current;
        if (!service) return;

        const predictions = await new Promise<google.maps.places.AutocompletePrediction[]>((resolve, reject) => {
          service.getPlacePredictions(request, (results, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && results) {
              resolve(results);
            } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
              resolve([]);
            } else {
              reject(new Error(`Places service error: ${status}`));
            }
          });
        });

        if (requestIdRef.current !== currentRequestId) {
          return;
        }

        setSuggestions(predictions);
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
    async (suggestion: google.maps.places.AutocompletePrediction) => {
      if (!geocodingLib) {
        console.error("Geocoding library not loaded");
        return;
      }

      try {
        const geocoder = new geocodingLib.Geocoder();

        const response = await new Promise<google.maps.GeocoderResponse>((resolve, reject) => {
          geocoder.geocode({ placeId: suggestion.place_id }, (results, status) => {
            if (status === google.maps.GeocoderStatus.OK && results && results.length > 0) {
              resolve({ results } as google.maps.GeocoderResponse);
            } else {
              reject(new Error(`Geocoding error: ${status}`));
            }
          });
        });

        const result = response.results[0];
        const location = result.geometry.location;
        const lat = location.lat();
        const lng = location.lng();
        const address = result.formatted_address ?? suggestion.description;

        onPlaceSelect(lat, lng, address);
        sessionTokenRef.current = null;
        requestIdRef.current += 1;
        setSearchValue(address);
        setDebouncedSearchValue("");
        setSuggestions([]);
        setIsLoading(false);

        // Restore focus to input after selection
        inputRef.current?.focus();
      } catch (error) {
        console.error("Error fetching place details:", error);
      }
    },
    [geocodingLib, onPlaceSelect]
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
    <APIProvider apiKey={apiKey}>
      <MapLocationPickerInner {...props} />
    </APIProvider>
  );
};

export default MapLocationPicker;
