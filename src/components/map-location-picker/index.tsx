import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Input, Typography, Space, type InputRef } from "antd";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
  type MapMouseEvent,
} from "@vis.gl/react-google-maps";

interface GooglePlacesAutocompleteProps {
  onPlaceSelect: (lat: number, lng: number, address: string) => void;
}

const GooglePlacesAutocomplete: React.FC<GooglePlacesAutocompleteProps> = ({
  onPlaceSelect,
}) => {
  const placesLib = useMapsLibrary("places");
  const inputRef = useRef<InputRef>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null);

  useEffect(() => {
    if (!placesLib || !inputRef.current?.input) {
      return;
    }

    // Get the actual HTML input element from Ant Design's Input component
    const inputElement = inputRef.current.input;

    // Create native Google Places Autocomplete widget
    const autocomplete = new placesLib.Autocomplete(inputElement, {
      componentRestrictions: { country: "id" },
      // No 'types' restriction - allow all place types (pharmacies, clinics, etc.)
    });

    autocompleteRef.current = autocomplete;

    // Add place_changed listener
    listenerRef.current = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();

      if (!place.geometry?.location) {
        console.warn("Place has no geometry");
        return;
      }

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const address = place.formatted_address ?? place.name ?? "";

      onPlaceSelect(lat, lng, address);
    });

    // Cleanup on unmount
    return () => {
      if (listenerRef.current) {
        listenerRef.current.remove();
        listenerRef.current = null;
      }
      if (autocompleteRef.current) {
        // Clear all listeners on the autocomplete instance
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
        autocompleteRef.current = null;
      }
    };
  }, [placesLib, onPlaceSelect]);

  return (
    <Input
      ref={inputRef}
      placeholder="Cari apotek, klinik, atau lokasi..."
      autoComplete="off"
      spellCheck={false}
    />
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
