import { useState, useEffect, useCallback, useRef } from "react";
import { Input, List, Typography, Space, Spin } from "antd";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";

interface PlaceSuggestion {
  placePrediction: google.maps.places.PlacePrediction;
}

interface GooglePlacesAutocompleteProps {
  onPlaceSelect: (lat: number, lng: number, address: string) => void;
}

const GooglePlacesAutocomplete: React.FC<GooglePlacesAutocompleteProps> = ({
  onPlaceSelect,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const placesLib = useMapsLibrary("places");
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!placesLib) return;

    if (inputValue.trim() === "") {
      setSuggestions([]);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsLoading(true);

      const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;

      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new AutocompleteSessionToken();
      }

      try {
        const request: google.maps.places.AutocompleteRequest = {
          input: inputValue,
          sessionToken: sessionTokenRef.current,
          includedRegionCodes: ["ID"],
        };

        const response = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        setSuggestions(response.suggestions as PlaceSuggestion[]);
      } catch (error) {
        console.error("Places API error:", error);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [inputValue, placesLib]);

  const handleSuggestionClick = useCallback(
    async (suggestion: PlaceSuggestion) => {
      if (!suggestion.placePrediction) return;

      const place = suggestion.placePrediction.toPlace();

      await place.fetchFields({
        fields: ["location", "formattedAddress"],
      });

      const lat = place.location?.lat();
      const lng = place.location?.lng();
      const address = place.formattedAddress ?? "";

      if (lat !== undefined && lng !== undefined) {
        onPlaceSelect(lat, lng, address);
      }

      sessionTokenRef.current = null;
      setInputValue("");
      setSuggestions([]);
    },
    [onPlaceSelect]
  );

  return (
    <div style={{ width: "100%" }}>
      <Input
        placeholder="Cari apotek, klinik, atau lokasi..."
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        suffix={isLoading ? <Spin size="small" /> : null}
      />
      {suggestions.length > 0 && (
        <List
          size="small"
          bordered
          dataSource={suggestions}
          renderItem={(item) => (
            <List.Item
              style={{ cursor: "pointer", padding: "8px 12px" }}
              onClick={() => handleSuggestionClick(item)}
            >
              <Typography.Text
                style={{ fontSize: "12px", lineHeight: "1.4" }}
              >
                {item.placePrediction.text.text}
              </Typography.Text>
            </List.Item>
          )}
          style={{ maxHeight: "250px", overflow: "auto", marginTop: "8px" }}
        />
      )}
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
    if (map) {
      map.panTo({ lat, lng });
      if (zoom) {
        map.setZoom(zoom);
      }
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMapClick = useCallback(
    (e: any) => {
      const latLng = e.latLng as google.maps.LatLng | null;
      if (latLng) {
        const lat = latLng.lat();
        const lng = latLng.lng();
        setPosition({ lat, lng });
        onLocationChange?.(lat.toFixed(6), lng.toFixed(6));
      }
    },
    [onLocationChange]
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMarkerDragEnd = useCallback(
    (e: any) => {
      const latLng = e.latLng as google.maps.LatLng | null;
      if (latLng) {
        const lat = latLng.lat();
        const lng = latLng.lng();
        setPosition({ lat, lng });
        onLocationChange?.(lat.toFixed(6), lng.toFixed(6));
      }
    },
    [onLocationChange]
  );

  const handlePlaceSelect = useCallback(
    (lat: number, lng: number, _address: string) => {
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
      <div
        style={{ height, width: "100%", borderRadius: "8px", overflow: "hidden" }}
      >
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
          <AdvancedMarker
            position={position}
            draggable={true}
            onDragEnd={handleMarkerDragEnd}
          />
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
