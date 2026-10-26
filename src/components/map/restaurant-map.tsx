"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";

export type RestaurantMapItem = {
  id: string;
  name: string;
  category: string | null;
  price_tier: number;
  hygiene_score: number;
  hygiene_status: "RED" | "GREEN";
  lat: number;
  lng: number;
};

type RestaurantMapProps = {
  restaurants: RestaurantMapItem[];
  selectedRestaurantId: string | null;
  userLat: number;
  userLng: number;
  onSelectRestaurant: (restaurant: RestaurantMapItem) => void;
  className?: string;
};

const JATINANGOR_CENTER: L.LatLngExpression = [-6.9262, 107.7717];
const DEFAULT_ZOOM = 15;

function isRedFlag(restaurant: RestaurantMapItem): boolean {
  return restaurant.hygiene_status === "RED" || restaurant.hygiene_score < 50;
}

function MapViewportController({
  restaurants,
  selectedRestaurantId,
  userLat,
  userLng,
}: {
  restaurants: RestaurantMapItem[];
  selectedRestaurantId: string | null;
  userLat: number;
  userLng: number;
}) {
  const map = useMap();

  const selectedRestaurant = useMemo(
    () => restaurants.find((item) => item.id === selectedRestaurantId) ?? null,
    [restaurants, selectedRestaurantId],
  );

  useEffect(() => {
    if (selectedRestaurant) {
      map.flyTo([selectedRestaurant.lat, selectedRestaurant.lng], 16, {
        duration: 0.45,
      });
      return;
    }

    if (restaurants.length === 0) {
      map.setView([userLat, userLng], DEFAULT_ZOOM);
      return;
    }

    const bounds = L.latLngBounds([
      [userLat, userLng],
      ...restaurants.map(
        (restaurant) => [restaurant.lat, restaurant.lng] as [number, number],
      ),
    ]);

    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
  }, [map, restaurants, selectedRestaurant, userLat, userLng]);

  return null;
}

export function RestaurantMap({
  restaurants,
  selectedRestaurantId,
  userLat,
  userLng,
  onSelectRestaurant,
  className = "",
}: RestaurantMapProps) {
  const mapCenter: L.LatLngExpression =
    restaurants.length > 0
      ? [restaurants[0].lat, restaurants[0].lng]
      : [userLat, userLng];

  return (
    <div className={`relative h-full w-full ${className}`}>
      <MapContainer
        center={mapCenter}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
        className="z-0 h-full w-full rounded-2xl"
        attributionControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapViewportController
          restaurants={restaurants}
          selectedRestaurantId={selectedRestaurantId}
          userLat={userLat}
          userLng={userLng}
        />

        <CircleMarker
          center={[userLat, userLng]}
          radius={9}
          pathOptions={{
            color: "#0284c7",
            fillColor: "#0ea5e9",
            fillOpacity: 1,
            weight: 3,
          }}
        >
          <Popup>
            <span className="text-sm font-semibold text-slate-800">
              Lokasi kamu
            </span>
          </Popup>
        </CircleMarker>

        {restaurants.map((restaurant) => {
          const isSelected = selectedRestaurantId === restaurant.id;
          const redFlag = isRedFlag(restaurant);

          return (
            <CircleMarker
              key={restaurant.id}
              center={[restaurant.lat, restaurant.lng]}
              radius={isSelected ? 13 : 10}
              pathOptions={{
                color: redFlag ? "#be123c" : "#047857",
                fillColor: redFlag ? "#f43f5e" : "#10b981",
                fillOpacity: 0.95,
                weight: isSelected ? 4 : 2,
              }}
              eventHandlers={{
                click: () => onSelectRestaurant(restaurant),
              }}
            >
              <Popup>
                <div className="space-y-1 text-sm">
                  <p className="font-bold text-slate-900">{restaurant.name}</p>
                  <p className="text-slate-600">
                    {restaurant.category ?? "Umum"} · Skor{" "}
                    {restaurant.hygiene_score}
                  </p>
                  <p
                    className={
                      redFlag
                        ? "font-semibold text-rose-600"
                        : "font-semibold text-emerald-600"
                    }
                  >
                    {redFlag ? "Red Flag" : "Aman"}
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <div className="pointer-events-none absolute bottom-2 left-2 z-[1000] rounded-lg border border-slate-200/80 bg-white/90 px-2.5 py-1.5 text-[10px] font-medium text-slate-600 shadow-sm backdrop-blur">
        <span className="mr-2 inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          Aman
        </span>
        <span className="mr-2 inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
          Red Flag
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-sky-500" />
          Kamu
        </span>
      </div>
    </div>
  );
}

