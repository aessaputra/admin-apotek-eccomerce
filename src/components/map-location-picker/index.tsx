import { useState, useEffect, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import { Icon, LatLng } from "leaflet";
import { Input, Button, List, Typography, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import "leaflet/dist/leaflet.css";

// Fix default Leaflet marker icon issue with Vite bundler
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

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  class?: string;
}

const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
};

export interface MapLocationPickerProps {
  latitude?: string | number;
  longitude?: string | number;
  onLocationChange?: (lat: string, lng: string) => void;
  height?: string;
}

// Default to Jakarta, Indonesia
const DEFAULT_LAT = -6.2088;
const DEFAULT_LNG = 106.8456;

export const MapLocationPicker: React.FC<MapLocationPickerProps> = ({
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (onLocationChange) {
        onLocationChange(lat.toFixed(6), lng.toFixed(6));
      }
    },
    [onLocationChange]
  );

  const handleMarkerDragEnd = useCallback(
    (lat: number, lng: number) => {
      setPosition(new LatLng(lat, lng));
      if (onLocationChange) {
        onLocationChange(lat.toFixed(6), lng.toFixed(6));
      }
    },
    [onLocationChange]
  );

  const searchAddress = useCallback(async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery
        )}&countrycodes=ID&limit=10&addressdetails=1&extratags=1`,
        {
          headers: {
            "User-Agent": "PharmaAdmin-MapPicker/1.0 (pharmacy-admin@example.com)",
          },
        }
      );
      const data: NominatimResult[] = await response.json();
      setSearchResults(data);
    } catch (error) {
      console.error("Geocoding error:", error);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      searchAddress();
    }
  };

  const handleResultSelect = (result: NominatimResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    setPosition(new LatLng(lat, lng));
    setZoom(16);
    setSearchResults([]);
    if (onLocationChange) {
      onLocationChange(lat.toFixed(6), lng.toFixed(6));
    }
  };

  return (
    <div style={{ width: "100%" }}>
      <Space direction="vertical" style={{ width: "100%", marginBottom: 12 }}>
        <Input.Search
          placeholder="Cari alamat..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          onSearch={searchAddress}
          loading={loading}
          enterButton={<Button icon={<SearchOutlined />} />}
        />
        {searchResults.length > 0 && (
          <List
            size="small"
            bordered
            dataSource={searchResults}
            renderItem={(item) => (
              <List.Item
                style={{ cursor: "pointer", padding: "8px 12px" }}
                onClick={() => handleResultSelect(item)}
              >
                <Typography.Text
                  style={{ fontSize: "12px", lineHeight: "1.4" }}
                  title={item.display_name}
                >
                  {truncateText(item.display_name, 80)}
                </Typography.Text>
              </List.Item>
            )}
            style={{ maxHeight: "250px", overflow: "auto" }}
          />
        )}
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

export default MapLocationPicker;
