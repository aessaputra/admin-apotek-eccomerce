import { useState, useEffect, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import { Icon, LatLng } from "leaflet";
import { Input, List, Typography, Space, Spin } from "antd";
import { APIProvider, useMapsLibrary } from "@vis.gl/react-google-maps";
import "leaflet/dist/leaflet.css";

import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const defaultIcon = new Icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface MapClickHandlerProps {
  onLocationSelect: (lat: number, lng: number) => void;
}

const MapClickHandler: React.FC<MapClickHandlerProps> = ({
  onLocationSelect,
}) => {
  useMapEvents({
    click: (e) => {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
};

interface MapControllerProps {
  center: LatLng;
  zoom: number;
}

const MapController: React.FC<MapControllerProps> = ({ center, zoom }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [map, center, zoom]);
  return null;
};

interface DraggableMarkerProps {
  position: LatLng;
  onDragEnd: (lat: number, lng: number) => void;
}

const DraggableMarker: React.FC<DraggableMarkerProps> = ({
  position,
  onDragEnd,
}) => {
  const [markerPosition, setMarkerPosition] = useState<LatLng>(position);

  useEffect(() => {
    setMarkerPosition(position);
  }, [position]);

  const eventHandlers = {
    dragend: (e: { target: { getLatLng: () => LatLng } }) => {
      const newPos = e.target.getLatLng();
      setMarkerPosition(newPos);
      onDragEnd(newPos.lat, newPos.lng);
    },
  };

  return (
    <Marker
      position={markerPosition}
      icon={defaultIcon}
      draggable={true}
      eventHandlers={eventHandlers}
    />
  );
};

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

const MapLocationPickerInner: React.FC<MapLocationPickerProps> = ({
  latitude,
  longitude,
  onLocationChange,
  height = "300px",
}) => {
  const [position, setPosition] = useState<LatLng>(() => {
    const lat =
      typeof latitude === "string"
        ? parseFloat(latitude) || DEFAULT_LAT
        : latitude ?? DEFAULT_LAT;
    const lng =
      typeof longitude === "string"
        ? parseFloat(longitude) || DEFAULT_LNG
        : longitude ?? DEFAULT_LNG;
    return new LatLng(lat, lng);
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
    setPosition(new LatLng(lat, lng));
  }, [latitude, longitude]);

  const handleLocationSelect = useCallback(
    (lat: number, lng: number) => {
      setPosition(new LatLng(lat, lng));
      onLocationChange?.(lat.toFixed(6), lng.toFixed(6));
    },
    [onLocationChange]
  );

  const handleMarkerDragEnd = useCallback(
    (lat: number, lng: number) => {
      setPosition(new LatLng(lat, lng));
      onLocationChange?.(lat.toFixed(6), lng.toFixed(6));
    },
    [onLocationChange]
  );

  const handlePlaceSelect = useCallback(
    (lat: number, lng: number, _address: string) => {
      setPosition(new LatLng(lat, lng));
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
        <MapContainer
          center={position}
          zoom={zoom}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
        >
          <MapController center={position} zoom={zoom} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <DraggableMarker position={position} onDragEnd={handleMarkerDragEnd} />
          <MapClickHandler onLocationSelect={handleLocationSelect} />
        </MapContainer>
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
