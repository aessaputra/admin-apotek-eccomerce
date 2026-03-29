import { useState, useEffect, useCallback, useRef } from "react";
import { Input, List, Typography, Space, message } from "antd";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import { Icon, type LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const DefaultIcon = new Icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
  importance: number;
}

export interface MapLocationPickerProps {
  latitude?: string | number;
  longitude?: string | number;
  onLocationChange?: (lat: string, lng: string) => void;
  height?: string;
}

const DEFAULT_LAT = -6.2088;
const DEFAULT_LNG = 106.8456;
const DEFAULT_ZOOM = 13;
const SEARCH_ZOOM = 16;

interface MapControllerProps {
  targetPosition: { lat: number; lng: number } | null;
  shouldFlyTo: boolean;
  onFlyComplete: () => void;
}

const MapController: React.FC<MapControllerProps> = ({
  targetPosition,
  shouldFlyTo,
  onFlyComplete,
}) => {
  const map = useMap();

  useEffect(() => {
    if (shouldFlyTo && targetPosition) {
      map.flyTo([targetPosition.lat, targetPosition.lng], SEARCH_ZOOM, {
        duration: 1.5,
      });
      onFlyComplete();
    }
  }, [map, targetPosition, shouldFlyTo, onFlyComplete]);

  return null;
};

interface SearchSectionProps {
  onLocationSelect: (lat: number, lng: number, displayName: string) => void;
}

const SearchSection: React.FC<SearchSectionProps> = ({ onLocationSelect }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSearch = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 3) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=ID&limit=5`,
        {
          headers: {
            "User-Agent": "PharmacyAdminPanel/1.0",
            "Accept-Language": "id",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: NominatimResult[] = await response.json();
      setSearchResults(data);
      setShowResults(data.length > 0);
    } catch (error) {
      console.error("Nominatim search error:", error);
      message.error("Gagal mencari lokasi. Silakan coba lagi.");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      performSearch(value);
    }, 500);
  };

  const handleSelectResult = (result: NominatimResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    onLocationSelect(lat, lng, result.display_name);
    setSearchQuery(result.display_name);
    setShowResults(false);
    setSearchResults([]);
  };

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div style={{ position: "relative", zIndex: 1000 }}>
      <Input.Search
        placeholder="Cari apotek, klinik, kecamatan, atau lokasi..."
        value={searchQuery}
        onChange={(e) => handleSearchChange(e.target.value)}
        loading={isSearching}
        allowClear
        onFocus={() => {
          if (searchResults.length > 0) setShowResults(true);
        }}
      />

      {showResults && searchResults.length > 0 && (
        <List
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            maxHeight: "250px",
            overflow: "auto",
            backgroundColor: "white",
            border: "1px solid #d9d9d9",
            borderRadius: "6px",
            marginTop: "4px",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
          }}
          dataSource={searchResults}
          renderItem={(item) => (
            <List.Item
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                borderBottom: "1px solid #f0f0f0",
              }}
              onClick={() => handleSelectResult(item)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelectResult(item);
                }
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "#f5f5f5";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "white";
              }}
              tabIndex={0}
              role="button"
              aria-label={`Select ${item.display_name}`}
            >
              <Typography.Text style={{ fontSize: "13px" }}>
                {item.display_name}
              </Typography.Text>
            </List.Item>
          )}
        />
      )}

      {showResults && (
        <button
          type="button"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: -1,
            opacity: 0,
            cursor: "default",
            border: "none",
            padding: 0,
            margin: 0,
            background: "transparent",
          }}
          onClick={() => setShowResults(false)}
          aria-label="Close search results"
        />
      )}
    </div>
  );
};

interface DraggableMarkerProps {
  position: { lat: number; lng: number };
  onDragEnd: (lat: number, lng: number) => void;
}

const DraggableMarker: React.FC<DraggableMarkerProps> = ({
  position,
  onDragEnd,
}) => {
  const [dragPosition, setDragPosition] = useState(position);

  useEffect(() => {
    setDragPosition(position);
  }, [position]);

  const eventHandlers = {
    dragend: (e: { target: { getLatLng: () => { lat: number; lng: number } } }) => {
      const newPos = e.target.getLatLng();
      setDragPosition({ lat: newPos.lat, lng: newPos.lng });
      onDragEnd(newPos.lat, newPos.lng);
    },
  };

  return (
    <Marker
      position={[dragPosition.lat, dragPosition.lng] as LatLngExpression}
      icon={DefaultIcon}
      draggable={true}
      eventHandlers={eventHandlers}
    />
  );
};

interface MapClickHandlerProps {
  onMapClick: (lat: number, lng: number) => void;
}

const MapClickHandler: React.FC<MapClickHandlerProps> = ({ onMapClick }) => {
  const map = useMap();

  useEffect(() => {
    const handleClick = (e: { latlng: { lat: number; lng: number } }) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    };

    map.on("click", handleClick);

    return () => {
      map.off("click", handleClick);
    };
  }, [map, onMapClick]);

  return null;
};

export const MapLocationPicker: React.FC<MapLocationPickerProps> = ({
  latitude,
  longitude,
  onLocationChange,
  height = "300px",
}) => {
  const getInitialPosition = useCallback(() => {
    const lat =
      typeof latitude === "string"
        ? parseFloat(latitude) || DEFAULT_LAT
        : latitude ?? DEFAULT_LAT;
    const lng =
      typeof longitude === "string"
        ? parseFloat(longitude) || DEFAULT_LNG
        : longitude ?? DEFAULT_LNG;
    return { lat, lng };
  }, [latitude, longitude]);

  const [position, setPosition] = useState(getInitialPosition);
  const [flyToPosition, setFlyToPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [shouldFly, setShouldFly] = useState(false);

  useEffect(() => {
    const newPos = getInitialPosition();
    setPosition(newPos);
  }, [getInitialPosition]);

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      setPosition({ lat, lng });
      onLocationChange?.(lat.toFixed(6), lng.toFixed(6));
    },
    [onLocationChange]
  );

  const handleMarkerDragEnd = useCallback(
    (lat: number, lng: number) => {
      setPosition({ lat, lng });
      onLocationChange?.(lat.toFixed(6), lng.toFixed(6));
    },
    [onLocationChange]
  );

  const handleLocationSelect = useCallback(
    (lat: number, lng: number, _displayName: string) => {
      setPosition({ lat, lng });
      setFlyToPosition({ lat, lng });
      setShouldFly(true);
      onLocationChange?.(lat.toFixed(6), lng.toFixed(6));
    },
    [onLocationChange]
  );

  const handleFlyComplete = useCallback(() => {
    setShouldFly(false);
  }, []);

  return (
    <div style={{ width: "100%" }}>
      <Space direction="vertical" style={{ width: "100%", marginBottom: 12 }}>
        <SearchSection onLocationSelect={handleLocationSelect} />
        <Typography.Text type="secondary" style={{ fontSize: "12px" }}>
          Atau klik langsung pada peta / seret pin untuk memilih lokasi tepat
        </Typography.Text>
      </Space>

      <div
        style={{
          height,
          width: "100%",
          borderRadius: "8px",
          overflow: "hidden",
          border: "1px solid #d9d9d9",
        }}
      >
        <MapContainer
          center={[position.lat, position.lng] as LatLngExpression}
          zoom={DEFAULT_ZOOM}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapController
            targetPosition={flyToPosition}
            shouldFlyTo={shouldFly}
            onFlyComplete={handleFlyComplete}
          />

          <MapClickHandler onMapClick={handleMapClick} />

          <DraggableMarker position={position} onDragEnd={handleMarkerDragEnd} />
        </MapContainer>
      </div>
    </div>
  );
};

export default MapLocationPicker;
