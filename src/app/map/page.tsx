"use client";

import type { RestaurantMapItem } from "@/components/map/restaurant-map";
import { AppHeader } from "@/components/home/app-header";
import { BottomNav } from "@/components/home/bottom-nav";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

const RestaurantMap = dynamic(
  () =>
    import("@/components/map/restaurant-map").then(
      (module) => module.RestaurantMap,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[350px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium text-slate-500">
        Memuat peta...
      </div>
    ),
  },
);

type Restaurant = RestaurantMapItem & {
  is_verified_safe: boolean;
};

const DEFAULT_LOCATION = { lat: -6.9262, lng: 107.7717 };

function statusLabel(status: Restaurant["hygiene_status"]): string {
  return status === "GREEN" ? "AMAN" : "RED FLAG";
}

// Menyesuaikan warna badge agar senada dengan tema Light Mode
function statusTone(status: Restaurant["hygiene_status"]): string {
  return status === "GREEN"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-rose-50 text-rose-700 border-rose-200";
}

function MapPageFallback() {
  return (
    <main className="min-h-screen bg-slate-100 pb-24 font-sans text-slate-800 md:pb-12">
      <header className="sticky top-0 z-50 border-b border-slate-200/60 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-lg md:px-8">
        <h1 className="text-lg font-bold text-slate-800">Peta Higienitas</h1>
      </header>
      <div className="mx-auto flex max-w-6xl items-center justify-center px-4 py-20 text-sm font-medium text-slate-500">
        Memuat peta...
      </div>
    </main>
  );
}

function MapPageContent() {
  const searchParams = useSearchParams();
  const restaurantIdFromUrl = searchParams.get("restaurant_id");

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRestaurant, setSelectedRestaurant] =
    useState<Restaurant | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "GREEN" | "RED">(
    "ALL",
  );
  const [reportDescription, setReportDescription] = useState("");
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [userLat, setUserLat] = useState(DEFAULT_LOCATION.lat);
  const [userLng, setUserLng] = useState(DEFAULT_LOCATION.lng);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number | null>(
    null,
  );
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const resolveSelectedRestaurant = useCallback(
    (list: Restaurant[], preferredId?: string | null) => {
      if (preferredId) {
        const fromPreferred = list.find((item) => item.id === preferredId);
        if (fromPreferred) {
          return fromPreferred;
        }
      }

      return list[0] ?? null;
    },
    [],
  );

  const loadRestaurants = async (preferredRestaurantId?: string | null) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/restaurants", { cache: "no-store" });
      const payload = (await response.json()) as {
        data?: Restaurant[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to fetch restaurants");
      }

      const nextRestaurants = payload.data ?? [];
      setRestaurants(nextRestaurants);

      const targetId = preferredRestaurantId ?? restaurantIdFromUrl;
      setSelectedRestaurant((current) => {
        if (targetId) {
          const matched = nextRestaurants.find((item) => item.id === targetId);
          if (matched) {
            return matched;
          }
        }

        if (
          current &&
          nextRestaurants.some((item) => item.id === current.id)
        ) {
          return current;
        }

        return resolveSelectedRestaurant(nextRestaurants, targetId);
      });
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to fetch restaurants",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!autoRefreshInterval) return;

    const timer = setInterval(() => {
      void loadRestaurants();
    }, autoRefreshInterval);

    return () => clearInterval(timer);
  }, [autoRefreshInterval]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadRestaurants(restaurantIdFromUrl);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [restaurantIdFromUrl]);

  useEffect(() => {
    if (!restaurantIdFromUrl || restaurants.length === 0) {
      return;
    }

    const matched = restaurants.find((item) => item.id === restaurantIdFromUrl);
    if (matched) {
      setSelectedRestaurant(matched);
      setStatusFilter("ALL");
      setQuery("");
    }
  }, [restaurantIdFromUrl, restaurants]);

  useEffect(() => {
    if (!navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLat(position.coords.latitude);
        setUserLng(position.coords.longitude);
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 6000 },
    );
  }, []);

  const filteredRestaurants = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return restaurants.filter((restaurant) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        restaurant.name.toLowerCase().includes(normalizedQuery) ||
        (restaurant.category ?? "").toLowerCase().includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "ALL" || restaurant.hygiene_status === statusFilter;

      return matchesQuery && matchesStatus;
    });
  }, [query, restaurants, statusFilter]);

  const uniqueRestaurants = useMemo(() => {
    const seen = new Set<string>();
    return filteredRestaurants.filter((restaurant) => {
      const key = `${restaurant.name}|${restaurant.category ?? ""}|${restaurant.price_tier}|${restaurant.hygiene_score}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [filteredRestaurants]);

  const sortedRestaurants = useMemo(
    () =>
      [...uniqueRestaurants].sort(
        (left, right) => right.hygiene_score - left.hygiene_score,
      ),
    [uniqueRestaurants],
  );

  const sendReport = async (reportType: "RED_FLAG" | "CLEAN") => {
    if (!selectedRestaurant) {
      return;
    }

    setIsSendingReport(true);
    setReportMessage(null);

    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant_id: selectedRestaurant.id,
          report_type: reportType,
          description: reportDescription.trim() || undefined,
        }),
      });

      const payload = (await response.json()) as {
        data?: Restaurant;
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        if (response.status === 429) {
          setReportMessage(
            payload.message ??
              "Kamu sudah melaporkan warung ini hari ini. Coba lagi besok ya.",
          );
          return;
        }
        setReportMessage(payload.error ?? "Gagal mengirim report.");
        return;
      }

      setReportMessage(
        reportType === "RED_FLAG"
          ? "Laporan Red Flag telah terkirim dan skor higienitas diperbarui."
          : "Laporan Clean telah terkirim dan skor higienitas naik jika valid.",
      );
      setReportDescription("");
      await loadRestaurants();
    } catch {
      setReportMessage("Tidak bisa menjangkau API report.");
    } finally {
      setIsSendingReport(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 pb-24 font-sans text-slate-800 md:pb-12">
      <AppHeader session={false} />

      <div className="mx-auto max-w-6xl w-full px-4 md:px-8 pt-6 flex flex-col lg:grid lg:grid-cols-[1.1fr_0.9fr] gap-6 lg:gap-8">
        {/* KOLOM KIRI: FILTER & PETA */}
        <section className="flex flex-col gap-5">
          {/* Panel Pencarian & Filter */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
              <label className="flex-1 space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">
                  Cari Restoran
                </span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    🔍
                  </span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Ayam, warteg..."
                    className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-sky-400 focus:bg-white transition-colors"
                  />
                </div>
              </label>

              <div className="flex gap-4">
                <div className="space-y-1.5">
                  <span className="block text-sm font-semibold text-slate-700">
                    Auto-refresh
                  </span>
                  <select
                    value={autoRefreshInterval ?? ""}
                    onChange={(e) =>
                      setAutoRefreshInterval(
                        e.target.value ? parseInt(e.target.value) : null,
                      )
                    }
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white cursor-pointer"
                  >
                    <option value="">Off</option>
                    <option value="2000">2s</option>
                    <option value="5000">5s</option>
                    <option value="10000">10s</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-sm font-semibold text-slate-700">
                    Status
                  </span>
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    {[
                      ["ALL", "Semua"],
                      ["GREEN", "Aman"],
                      ["RED", "Red Flag"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setStatusFilter(value as typeof statusFilter)
                        }
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                          statusFilter === value
                            ? "bg-white text-slate-800 shadow-sm"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <p className="text-xs font-medium text-slate-500">
              Ditemukan{" "}
              <span className="font-bold text-slate-800">
                {sortedRestaurants.length}
              </span>{" "}
              restoran
            </p>
          </div>

          {/* Peta interaktif Leaflet + OpenStreetMap */}
          <div className="relative h-[350px] overflow-hidden rounded-xl border border-slate-200 bg-white md:h-[450px]">
            {isLoading ? (
              <div className="flex h-full items-center justify-center bg-slate-50 text-sm font-medium text-slate-500">
                Memuat peta restoran...
              </div>
            ) : error ? (
              <div className="flex h-full items-center justify-center bg-rose-50 px-6 text-center text-sm font-medium text-rose-600">
                {error}
              </div>
            ) : (
              <RestaurantMap
                restaurants={sortedRestaurants}
                selectedRestaurantId={selectedRestaurant?.id ?? null}
                userLat={userLat}
                userLng={userLng}
                onSelectRestaurant={(restaurant) => {
                  const fullRestaurant =
                    sortedRestaurants.find((item) => item.id === restaurant.id) ??
                    null;
                  setSelectedRestaurant(fullRestaurant);
                }}
                className="h-full"
              />
            )}
          </div>

          {/* Restaurant Mobile Picker (Drop list) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 lg:hidden">
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-slate-700">
                Pilih dari daftar
              </span>
              <button
                type="button"
                onClick={() => setIsPickerOpen(true)}
                disabled={isLoading || sortedRestaurants.length === 0}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-800 outline-none transition hover:border-sky-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="truncate">
                  {selectedRestaurant
                    ? `${selectedRestaurant.name}`
                    : "Pilih restoran"}
                </span>
                <span className="text-slate-400">▾</span>
              </button>
            </div>
          </div>

          {/* Modal Picker (Muncul kalau ditekan di Mobile) */}
          {isPickerOpen ? (
            <div className="fixed inset-0 z-50 flex items-end bg-slate-900/40 backdrop-blur-sm lg:hidden">
              <div className="w-full rounded-t-3xl border-t border-slate-200 bg-white p-5 shadow-2xl">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-base font-bold text-slate-900">
                    Daftar Restoran
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsPickerOpen(false)}
                    className="rounded-full bg-slate-100 px-4 py-1.5 text-xs font-semibold text-slate-600 active:scale-95 transition-transform"
                  >
                    Tutup
                  </button>
                </div>
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {sortedRestaurants.map((restaurant) => (
                    <button
                      key={restaurant.id}
                      type="button"
                      onClick={() => {
                        setSelectedRestaurant(restaurant);
                        setIsPickerOpen(false);
                      }}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                        selectedRestaurant?.id === restaurant.id
                          ? "border-sky-200 bg-sky-50"
                          : "border-slate-100 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <p className="truncate text-sm font-bold text-slate-900">
                        {restaurant.name}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-xs font-medium text-slate-500">
                        <span>{restaurant.category ?? "Umum"}</span>
                        <span>•</span>
                        <span>
                          Rp {restaurant.price_tier.toLocaleString("id-ID")}
                        </span>
                        <span>•</span>
                        <span
                          className={
                            restaurant.hygiene_status === "GREEN"
                              ? "text-emerald-600"
                              : "text-rose-600"
                          }
                        >
                          {restaurant.hygiene_status === "GREEN" ? "✓" : "⚠"}{" "}
                          {restaurant.hygiene_score}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {/* KOLOM KANAN: DETAIL RESTORAN & REPORT */}
        <aside className="flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5">
          {/* Header Detail */}
          <div className="border-b border-slate-100 pb-4">
            <p className="text-xs font-medium text-slate-500">
              Detail Restoran
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              {selectedRestaurant?.name ?? "Pilih restoran"}
            </h2>
          </div>

          {isLoading ? (
            <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 text-sm font-medium text-slate-500 text-center">
              Memuat data dari server...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">
              {error}
            </div>
          ) : selectedRestaurant ? (
            <div className="flex-1 space-y-6 overflow-y-auto">
              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                <span
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${statusTone(selectedRestaurant.hygiene_status)}`}
                >
                  {statusLabel(selectedRestaurant.hygiene_status)}
                </span>
                <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                  Rp {selectedRestaurant.price_tier.toLocaleString("id-ID")}
                </span>
                <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                  {selectedRestaurant.category ?? "Umum"}
                </span>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[11px] font-medium text-slate-500">
                    Skor Kebersihan
                  </p>
                  <p className="mt-1 text-3xl font-bold text-slate-800">
                    {selectedRestaurant.hygiene_score}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[11px] font-medium text-slate-500">
                    Status Verified
                  </p>
                  <p className="mt-1.5 text-lg font-bold text-slate-800">
                    {selectedRestaurant.is_verified_safe ? (
                      <span className="text-emerald-500 flex items-center gap-1">
                        ✓ <span className="text-sm">Verified</span>
                      </span>
                    ) : (
                      <span className="text-slate-400">- Belum</span>
                    )}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[11px] font-medium text-slate-500">
                    Latitude
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    {selectedRestaurant.lat.toFixed(5)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[11px] font-medium text-slate-500">
                    Longitude
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    {selectedRestaurant.lng.toFixed(5)}
                  </p>
                </div>
              </div>

              {/* Report Section */}
              <div className="border-t border-slate-100 pt-5">
                <label className="block space-y-2">
                  <span className="text-sm font-bold text-slate-800">
                    Catatan Report
                  </span>
                  <textarea
                    value={reportDescription}
                    onChange={(event) =>
                      setReportDescription(event.target.value)
                    }
                    placeholder="Contoh: Meja kurang bersih, atau lalat di etalase..."
                    rows={3}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:bg-white resize-none"
                  />
                </label>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => void sendReport("RED_FLAG")}
                    disabled={isSendingReport}
                    className="rounded-xl border border-rose-200 bg-rose-50 py-3 text-xs font-bold text-rose-600 transition hover:bg-rose-100 active:scale-95 disabled:opacity-50"
                  >
                    ⚠ Lapor Red Flag
                  </button>
                  <button
                    type="button"
                    onClick={() => void sendReport("CLEAN")}
                    disabled={isSendingReport}
                    className="rounded-xl border border-emerald-200 bg-emerald-50 py-3 text-xs font-bold text-emerald-600 transition hover:bg-emerald-100 active:scale-95 disabled:opacity-50"
                  >
                    ✓ Lapor Clean
                  </button>
                </div>

                {reportMessage ? (
                  <p className="mt-4 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs font-medium text-sky-700 leading-snug">
                    {reportMessage}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-200 rounded-xl">
              <span className="text-3xl mb-3 opacity-50">🧭</span>
              <p className="text-sm font-medium text-slate-400">
                Pilih restoran dari peta atau daftar untuk melihat detail dan
                mengirim laporan.
              </p>
            </div>
          )}
        </aside>
      </div>
      <BottomNav />
    </main>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<MapPageFallback />}>
      <MapPageContent />
    </Suspense>
  );
}
