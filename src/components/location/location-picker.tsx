"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin } from "lucide-react";

import {
  AREA_PRESETS,
  DEFAULT_AREA,
  describeLocation,
  readPermissionState,
  readSavedLocation,
  saveLocation,
  type LocationChoice,
  type PermissionState,
} from "@/lib/location";

/**
 * Meminta lokasi tanpa membuat orang mentok.
 *
 * Alurnya sengaja menjelaskan dulu, baru memicu prompt browser. Prompt yang
 * muncul tiba-tiba hampir selalu ditolak, dan izin yang sudah ditolak tidak
 * bisa diminta lagi tanpa pengguna membuka setelan browser — satu penolakan
 * berarti selamanya, kecuali kita punya jalur manual yang setara.
 */
export function LocationPicker({
  value,
  onChange,
}: {
  value: LocationChoice | null;
  onChange: (choice: LocationChoice) => void;
}) {
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [isLocating, setIsLocating] = useState(false);
  const [isPickingArea, setIsPickingArea] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const commit = useCallback(
    (choice: LocationChoice) => {
      saveLocation(choice);
      onChange(choice);
    },
    [onChange],
  );

  const requestGps = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("Browser kamu tidak mendukung deteksi lokasi.");
      setIsPickingArea(true);
      return;
    }

    setIsLocating(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocating(false);
        setPermission("granted");
        commit({
          source: "gps",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        setIsLocating(false);
        // Ditolak bukan error yang perlu disesali — cukup pindah jalur.
        const denied = error.code === error.PERMISSION_DENIED;
        if (denied) setPermission("denied");
        setGpsError(
          denied
            ? "Nggak apa-apa. Pilih areamu di bawah aja."
            : "Lokasi nggak kebaca. Pilih areamu di bawah aja.",
        );
        setIsPickingArea(true);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }, [commit]);

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      const state = await readPermissionState();
      if (cancelled) return;
      setPermission(state);

      const saved = readSavedLocation();
      if (saved) {
        // Pilihan terakhir dipakai langsung. Tidak ada prompt, tidak ada
        // pertanyaan yang sama dua kali.
        onChange(saved);
        return;
      }

      // Izin yang sudah diberikan sebelumnya boleh dipakai tanpa bertanya —
      // di titik ini prompt tidak akan muncul lagi.
      if (state === "granted") requestGps();
    };

    void restore();
    return () => {
      cancelled = true;
    };
    // Sengaja hanya sekali saat mount: ini pemulihan keadaan awal, bukan
    // sinkronisasi berkelanjutan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseArea = (areaId: string) => {
    const area = AREA_PRESETS.find((entry) => entry.id === areaId) ?? DEFAULT_AREA;
    setIsPickingArea(false);
    setGpsError(null);
    commit({ source: "area", lat: area.lat, lng: area.lng, areaId: area.id });
  };

  // --- Sudah ada pilihan: tampilkan ringkas, tidak menghalangi jalan ---
  if (value && !isPickingArea) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
        <span className="min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Cari di sekitar
          </span>
          <span className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-700">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-hidden="true" />
            {describeLocation(value)}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setIsPickingArea(true)}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
        >
          Ubah
        </button>
      </div>
    );
  }

  // --- Belum ada pilihan, atau sedang mengubah ---
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {!isPickingArea && permission !== "denied" && (
        <>
          <p className="text-sm font-semibold text-slate-700">
            Boleh tahu kamu di mana?
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
            Biar kami cuma nawarin yang deket kamu, bukan yang di seberang
            Jatinangor. Lokasinya nggak kami simpan.
          </p>

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={requestGps}
              disabled={isLocating}
              className="w-full rounded-lg bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition-transform active:scale-95 hover:bg-rose-600 disabled:opacity-60"
            >
              {isLocating ? "Mencari lokasi…" : "Pakai lokasi saya"}
            </button>
            <button
              type="button"
              onClick={() => setIsPickingArea(true)}
              className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
            >
              Pilih area sendiri
            </button>
          </div>
        </>
      )}

      {(isPickingArea || permission === "denied") && (
        <>
          <p className="text-sm font-semibold text-slate-700">Kamu lagi di mana?</p>
          {gpsError && (
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
              {gpsError}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {AREA_PRESETS.map((area) => {
              const isActive = value?.areaId === area.id;
              return (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => chooseArea(area.id)}
                  aria-pressed={isActive}
                  className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
                    isActive
                      ? "bg-rose-500 text-white"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {area.label}
                </button>
              );
            })}
          </div>

          {permission !== "denied" && (
            <button
              type="button"
              onClick={requestGps}
              disabled={isLocating}
              className="mt-3 text-xs font-semibold text-rose-500 underline underline-offset-2 disabled:opacity-60"
            >
              {isLocating ? "Mencari lokasi…" : "Atau pakai lokasi saya"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
