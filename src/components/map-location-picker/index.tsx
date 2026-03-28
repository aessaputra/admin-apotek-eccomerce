import { useState, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import { Icon, LatLng } from "leaflet";
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

  return (
    <div style={{ height, width: "100%", borderRadius: "8px", overflow: "hidden" }}>
      <MapContainer
        center={position}
        zoom={13}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <DraggableMarker position={position} onDragEnd={handleMarkerDragEnd} />
        <MapClickHandler onLocationSelect={handleLocationSelect} />
      </MapContainer>
    </div>
  );
};

export default MapLocationPicker;
