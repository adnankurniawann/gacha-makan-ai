"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { MotionProvider } from "@/components/motion/motion-provider";
import { LocationPicker } from "@/components/location/location-picker";
import { AppHeader } from "@/components/home/app-header";
import {
  Bookmark,
  BookmarkCheck,
  Clock,
  Dices,
  DoorClosed,
  DoorOpen,
  MapPin,
  RotateCw,
  ShieldCheck,
  Utensils,
  UtensilsCrossed,
} from "lucide-react";
import { BottomNav } from "@/components/home/bottom-nav";
import { DEFAULT_AREA, type LocationChoice } from "@/lib/location";
import {
  getSpinSessionId,
  readSavedFilters,
  saveFilters,
} from "@/lib/spin-session";
import { ShareResultButton } from "@/components/spin/share-result-button";

type SpinResult = {
  id: string;
  name: string;
  category: string | null;
  price_tier: number;
  distance: number;
  hygiene_score: number;
  /** `null` berarti jam bukanya belum terdata, bukan berarti tutup. */
  is_open: boolean | null;
};

/**
 * Saran yang dikirim /api/spin saat tidak ada kandidat. Nilainya sudah
 * diverifikasi server (radius/budget itu memang menghasilkan kandidat), jadi
 * tombolnya aman ditawarkan — bukan tebakan yang berujung gagal lagi.
 */
type SpinSuggestions = {
  radius: number | null;
  budget: number | null;
  /** Kandidatnya ada, tapi semuanya sedang tutup. */
  includeClosed: boolean;
};

const MIN_SPIN_DURATION_MS = 1300;

// Batas slider. Saran dari server dijepit ke rentang ini supaya nilai yang
// dipakai untuk spin selalu sama dengan yang terlihat di slider.
const BUDGET_MIN = 10000;
const BUDGET_MAX = 50000;
const RADIUS_MIN = 500;
const RADIUS_MAX = 5000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function formatMeters(value: number): string {
  return value >= 1000
    ? `${(value / 1000).toFixed(1)} km`
    : `${Math.round(value)} m`;
}

function hygieneLabel(score: number): string {
  if (score >= 85) return "AMAN";
  if (score >= 50) return "PERLU DICEK";
  return "TIDAK AMAN";
}

export default function SpinPage() {
  const [budget, setBudget] = useState(20000);
  const [radius, setRadius] = useState(1500);
  // Titik acuan sebelum pengguna memilih. Bukan "lokasi pengguna" — hanya
  // nilai awal supaya slider dan pratinjau punya angka yang masuk akal.
  const [location, setLocation] = useState<LocationChoice | null>(null);
  const lat = location?.lat ?? DEFAULT_AREA.lat;
  const lng = location?.lng ?? DEFAULT_AREA.lng;
  const [isSpinning, setIsSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SpinSuggestions | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  // Id baris spin_events untuk penayangan yang sedang tampil. `null` berarti
  // penayangan ini tidak tercatat — tombolnya tetap jalan, cuma tanpa label.
  const [eventId, setEventId] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);

  // Lokasi sepenuhnya diurus LocationPicker: ia yang menjelaskan alasannya
  // sebelum memicu prompt browser, menyediakan pilihan area manual saat izinnya
  // ditolak, dan mengingat pilihan terakhir. Halaman ini cukup menerima
  // hasilnya.

  // Filter tersimpan dipulihkan sekali saat mount. Mengatur ulang radius dan
  // budget tiap kali buka adalah gesekan yang tidak perlu.
  //
  // Harus lewat effect, bukan lazy useState: halaman ini di-prerender, dan
  // membaca localStorage saat render awal membuat HTML hasil hidrasi berbeda
  // dari HTML yang dikirim server. Satu render tambahan setelah mount jauh
  // lebih murah daripada hydration mismatch pada slider.
  useEffect(() => {
    const saved = readSavedFilters({
      budgetMin: BUDGET_MIN,
      budgetMax: BUDGET_MAX,
      radiusMin: RADIUS_MIN,
      radiusMax: RADIUS_MAX,
    });
    if (!saved) return;

    /* eslint-disable react-hooks/set-state-in-effect */
    setBudget(saved.budget);
    setRadius(saved.radius);
    setOnlyOpen(saved.onlyOpen);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  /**
   * Melaporkan respons atas penayangan yang sedang tampil.
   *
   * Sengaja tidak ditunggu (`void`): tidak ada yang boleh menunggu jaringan
   * hanya untuk memberi tahu kita bahwa mereka jadi ke sana.
   */
  const reportAction = (action: "accepted" | "respun" | "saved") => {
    if (!eventId || answered) return;
    setAnswered(true);

    void fetch("/api/spin/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, action }),
      // Supaya laporannya tetap terkirim walau halamannya langsung ditinggal.
      keepalive: true,
    }).catch(() => {
      // Kehilangan satu label reward bukan alasan mengganggu siapa pun.
    });
  };

  const runSpin = async (
    spinBudget: number,
    spinRadius: number,
    spinOnlyOpen: boolean,
  ) => {
    // Spin ulang selagi ada hasil di layar ADALAH jawabannya: hasil tadi tidak
    // dipakai. Dicatat sebelum permintaan baru dikirim, supaya penayangan lama
    // tidak hilang tanpa label.
    if (result && !answered) reportAction("respun");

    setIsSpinning(true);
    setError(null);
    setSuggestions(null);
    setResult(null);
    setEventId(null);
    setAnswered(false);
    setIsSaved(false);
    setConfirmMessage(null); // Reset pesan konfirmasi setiap kali spin ulang

    saveFilters({
      budget: spinBudget,
      radius: spinRadius,
      onlyOpen: spinOnlyOpen,
    });

    const minSpinDelay = new Promise<void>((resolve) => {
      window.setTimeout(resolve, MIN_SPIN_DURATION_MS);
    });

    let nextResult: SpinResult | null = null;
    let nextError: string | null = null;
    let nextSuggestions: SpinSuggestions | null = null;
    let nextEventId: string | null = null;

    try {
      const response = await fetch("/api/spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget: spinBudget,
          radius: spinRadius,
          user_lat: lat,
          user_lng: lng,
          only_open: spinOnlyOpen,
          session_id: getSpinSessionId() ?? undefined,
        }),
      });
      const payload = (await response.json()) as {
        data?: SpinResult;
        event_id?: string | null;
        error?: string;
        message?: string;
        suggestions?: SpinSuggestions;
      };
      if (!response.ok) {
        // `message` sudah ramah dan berbahasa Indonesia; `error` adalah teks
        // teknis yang hanya berguna kalau message tidak ada.
        nextError = payload.message ?? payload.error ?? "Spin gagal dijalankan.";
        nextSuggestions =
          payload.suggestions &&
          (payload.suggestions.radius !== null ||
            payload.suggestions.budget !== null ||
            payload.suggestions.includeClosed)
            ? payload.suggestions
            : null;
      } else {
        nextResult = payload.data ?? null;
        nextEventId = payload.event_id ?? null;
      }
    } catch {
      nextError = "Tidak bisa menjangkau API spin. Cek koneksi kamu ya.";
    } finally {
      await minSpinDelay;
      setError(nextError);
      setSuggestions(nextSuggestions);
      setResult(nextResult);
      setEventId(nextEventId);
      setIsSpinning(false);
    }
  };

  const handleSpin = () => runSpin(budget, radius, onlyOpen);

  const handleToggleOnlyOpen = (next: boolean) => {
    setOnlyOpen(next);
    // Hanya spin ulang kalau sudah pernah ada hasil atau error — kalau belum,
    // mengubah filter sebelum spin pertama tidak seharusnya memicu apa pun.
    if (result || error) void runSpin(budget, radius, next);
  };

  // Saran hanya ditawarkan kalau setelah dijepit ke rentang slider nilainya
  // benar-benar berubah — kalau tidak, tombolnya cuma mengulang spin yang sama.
  const suggestedRadius =
    suggestions?.radius != null
      ? clamp(suggestions.radius, RADIUS_MIN, RADIUS_MAX)
      : null;
  const suggestedBudget =
    suggestions?.budget != null
      ? clamp(suggestions.budget, BUDGET_MIN, BUDGET_MAX)
      : null;

  const canWidenRadius = suggestedRadius !== null && suggestedRadius > radius;
  const canRaiseBudget = suggestedBudget !== null && suggestedBudget > budget;
  const canIncludeClosed = Boolean(suggestions?.includeClosed) && onlyOpen;

  const handleWidenRadius = () => {
    if (suggestedRadius === null) return;
    setRadius(suggestedRadius);
    void runSpin(budget, suggestedRadius, onlyOpen);
  };

  const handleRaiseBudget = () => {
    if (suggestedBudget === null) return;
    setBudget(suggestedBudget);
    void runSpin(suggestedBudget, radius, onlyOpen);
  };

  const handleIncludeClosed = () => {
    setOnlyOpen(false);
    void runSpin(budget, radius, false);
  };
  
  const handleConfirmFood = async () => {
    if (!result) return;

    // Label reward dicatat lebih dulu dan tidak ditunggu. Dompet boleh gagal
    // dipotong tanpa membuat kita kehilangan sinyal bahwa rekomendasinya
    // diterima — itu dua hal yang berbeda.
    reportAction("accepted");

    setIsConfirming(true);
    setConfirmMessage(null);

    try {
      const res = await fetch("/api/wallet/deduct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: result.price_tier }),
      });

      if (res.ok) {
        setConfirmMessage("Selamat makan! Saldo sudah dipotong.");
      } else {
        setConfirmMessage("Saldo gagal dipotong.");
      }
    } catch {
      setConfirmMessage("Jaringan bermasalah. Coba lagi.");
    } finally {
      setIsConfirming(false);
    }
  };

  const handleSave = async () => {
    if (!result || isSaved) return;

    // Optimistis: menyimpan favorit itu murah dan hampir selalu berhasil.
    // Menunggu jaringan hanya untuk mengubah warna tombol terasa lambat.
    setIsSaved(true);
    reportAction("saved");

    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: result.id }),
      });
      if (!res.ok) setIsSaved(false);
    } catch {
      setIsSaved(false);
    }
  };

  // Logika kalkulasi panjang warna untuk slider (Progress bar warna)
  const budgetPercent = ((budget - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) * 100;
  const radiusPercent = ((radius - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN)) * 100;

  return (
    <MotionProvider>
          <main className="relative min-h-screen overflow-hidden bg-slate-100 pb-24 font-sans text-slate-900 selection:bg-rose-500 selection:text-white md:pb-10">
            {/* Background Decor */}
            {/* Header yang sama dengan seluruh halaman lain, supaya jalan ke
                peta dan riwayat selalu ada di tempat yang sama. */}
            <AppHeader session={false} />

            <div className="relative z-10 mx-auto max-w-6xl w-full px-4 md:px-8 pt-6 flex flex-col lg:grid lg:grid-cols-12 gap-6 lg:gap-8">
              {/* KOLOM KIRI: FILTERS */}
              <div className="lg:col-span-5 flex flex-col gap-6">
                {/* Active Filter Summary */}
                <div className="flex divide-x divide-slate-100 rounded-xl border border-slate-200 bg-white">
                  <div className="flex-1 px-4 py-3.5">
                    <p className="text-xs text-slate-500">Budget</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                      Rp {budget.toLocaleString("id-ID")}
                    </p>
                  </div>
                  <div className="flex-1 px-4 py-3.5">
                    <p className="text-xs text-slate-500">Radius</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                      {radius} m
                    </p>
                  </div>
                </div>

                {/* Control Panel - Dengan Slider Custom Berwarna */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-6">
                  {/* Slider Budget Custom */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-semibold text-slate-700">
                        Budget Maksimal
                      </span>
                      <span className="text-sm font-bold text-rose-500">
                        Rp {budget.toLocaleString("id-ID")}
                      </span>
                    </div>
                    <div className="relative w-full h-2.5 bg-slate-100 rounded-full mt-3">
                      <div
                        className="absolute top-0 left-0 h-full bg-rose-500 rounded-full"
                        style={{ width: `${budgetPercent}%` }}
                      ></div>
                      <input
                        type="range"
                        min={BUDGET_MIN}
                        max={BUDGET_MAX}
                        step="1000"
                        value={budget}
                        onChange={(e) => setBudget(Number(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-rose-500 rounded-full shadow-md border-[3px] border-white pointer-events-none transition-transform"
                        style={{ left: `calc(${budgetPercent}% - 10px)` }}
                      ></div>
                    </div>
                  </div>

                  {/* Slider Radius Custom */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-semibold text-slate-700">
                        Radius Pencarian
                      </span>
                      <span className="text-sm font-bold text-sky-500">
                        {radius} meter
                      </span>
                    </div>
                    <div className="relative w-full h-2.5 bg-slate-100 rounded-full mt-3">
                      <div
                        className="absolute top-0 left-0 h-full bg-sky-500 rounded-full"
                        style={{ width: `${radiusPercent}%` }}
                      ></div>
                      <input
                        type="range"
                        min={RADIUS_MIN}
                        max={RADIUS_MAX}
                        step="250"
                        value={radius}
                        onChange={(e) => setRadius(Number(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-sky-500 rounded-full shadow-md border-[3px] border-white pointer-events-none transition-transform"
                        style={{ left: `calc(${radiusPercent}% - 10px)` }}
                      ></div>
                    </div>
                  </div>

                  {/* Filter jam buka. Menyala secara default: mengirim orang ke
                      warung yang sudah tutup adalah cara tercepat kehilangan mereka. */}
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 cursor-pointer">
                    <span>
                      <span className="block text-sm font-semibold text-slate-700">
                        Cuma yang buka sekarang
                      </span>
                      <span className="block text-[11px] leading-snug text-slate-400">
                        Yang jam bukanya belum terdata tetap ikut muncul
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={onlyOpen}
                      onChange={(e) => handleToggleOnlyOpen(e.target.checked)}
                      className="h-5 w-5 shrink-0 accent-emerald-500 cursor-pointer"
                    />
                  </label>

                  {/* Menggantikan dua kotak isian latitude/longitude. Angka
                      koordinat mentah berguna saat mengembangkan, tapi tidak
                      ada yang mengetik -6.9262 sambil berdiri di pinggir
                      jalan. */}
                  <LocationPicker value={location} onChange={setLocation} />
                </div>
              </div>

              {/* KOLOM KANAN: SPIN ACTION & RESULT */}
              <div className="lg:col-span-7 flex flex-col gap-6">
                <div className="relative flex min-h-[360px] flex-col items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-6 md:p-10">
                  {/* Animasi Ring Cincin */}
                  <m.div
                    key={isSpinning ? "spinning" : "idle"}
                    className="absolute top-1/2 left-1/2 w-48 h-48 sm:w-56 sm:h-56 rounded-full border-4 border-dashed border-rose-200 pointer-events-none opacity-80"
                    initial={{ x: "-50%", y: "-50%" }}
                    animate={
                      isSpinning
                        ? {
                            rotate: 1080,
                            x: ["-50%", "-51%", "-49%", "-50%"],
                            y: ["-50%", "-49%", "-51%", "-50%"],
                          }
                        : {
                            rotate: 0,
                            x: "-50%",
                            y: "-50%",
                          }
                    }
                    transition={
                      isSpinning
                        ? {
                            rotate: { duration: 2, ease: "easeInOut" },
                            x: { duration: 0.1, repeat: 20 },
                            y: { duration: 0.1, repeat: 20 },
                          }
                        : { duration: 0 }
                    }
                  />

                  {/* Tombol Spin */}
                  <m.button
                    onClick={handleSpin}
                    disabled={isSpinning}
                    animate={isSpinning ? { scale: [0.95, 1, 0.95] } : { scale: 1 }}
                    transition={
                      isSpinning
                        ? { repeat: Infinity, duration: 1 }
                        : { duration: 0.2 }
                    }
                    className="relative z-10 flex h-40 w-40 flex-col items-center justify-center rounded-full border-4 border-white bg-rose-500 text-2xl font-semibold text-white shadow-xl shadow-rose-500/30 transition-all hover:bg-rose-600 active:scale-95 disabled:opacity-90 sm:h-44 sm:w-44"
                  >
                    <m.div
                      animate={isSpinning ? { rotate: 1080 } : { rotate: 0 }}
                      transition={
                        isSpinning
                          ? { duration: 2, ease: [0.25, 0.1, 0.25, 1] }
                          : { duration: 0 }
                      }
                      className="mb-2"
                    >
                      <Utensils className="h-9 w-9" aria-hidden="true" />
                    </m.div>
                    SPIN!
                  </m.button>

                  {error && (
                    <m.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      role="status"
                      className="mt-8 w-full max-w-sm p-4 bg-rose-50 border border-rose-100 rounded-xl text-center shadow-sm"
                    >
                      <p className="text-sm font-semibold text-rose-600 leading-snug">
                        {error}
                      </p>

                      {(canWidenRadius || canRaiseBudget || canIncludeClosed) && (
                        <div className="mt-3 flex flex-col gap-2">
                          {canIncludeClosed && (
                            <button
                              type="button"
                              onClick={handleIncludeClosed}
                              disabled={isSpinning}
                              className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-transform active:scale-95 hover:bg-amber-600 disabled:opacity-50"
                            >
                              Tampilkan yang lagi tutup juga
                            </button>
                          )}
                          {canWidenRadius && (
                            <button
                              type="button"
                              onClick={handleWidenRadius}
                              disabled={isSpinning}
                              className="w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition-transform active:scale-95 hover:bg-sky-600 disabled:opacity-50"
                            >
                              Lebarkan radius jadi {suggestedRadius} m
                            </button>
                          )}
                          {canRaiseBudget && (
                            <button
                              type="button"
                              onClick={handleRaiseBudget}
                              disabled={isSpinning}
                              className="w-full rounded-lg border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-600 transition-transform active:scale-95 hover:bg-rose-100 disabled:opacity-50"
                            >
                              Naikkan budget jadi Rp
                              {suggestedBudget?.toLocaleString("id-ID")}
                            </button>
                          )}
                        </div>
                      )}
                    </m.div>
                  )}
                </div>

                {/* RESULT AREA */}
                <AnimatePresence mode="wait">
                  {result ? (
                    <m.div
                      key={result.id}
                      initial={{ opacity: 0, y: 15, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.98 }}
                      className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5"
                    >
                      <p className="text-xs font-medium text-rose-500">
                        Hasil buat kamu
                      </p>
                      <h3 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">
                        {result.name}
                      </h3>
                      <div className="flex flex-wrap gap-2.5 mt-3">
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
                          Rp {result.price_tier.toLocaleString("id-ID")}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
                          <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> {formatMeters(result.distance)}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
                          <UtensilsCrossed className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> {result.category ?? "Umum"}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
                          <ShieldCheck className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> {result.hygiene_score}
                        </span>
                        {/* Tiga keadaan, bukan dua: "belum terdata" tidak boleh
                            menyamar jadi "buka". */}
                        {result.is_open === true && (
                          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                            <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" /> Buka sekarang
                          </span>
                        )}
                        {result.is_open === false && (
                          <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700">
                            <DoorClosed className="h-3.5 w-3.5" aria-hidden="true" /> Lagi tutup
                          </span>
                        )}
                        {result.is_open === null && (
                          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
                            <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Jam buka belum terdata
                          </span>
                        )}
                      </div>

                      {/* BAGIAN TOMBOL YANG DIUPDATE */}
                      <div className="mt-7 flex flex-col gap-3">
                        {confirmMessage ? (
                          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold text-center shadow-sm">
                            {confirmMessage}
                          </div>
                        ) : (
                          <>
                            {/* Tombol Konfirmasi Makan & Potong Saldo */}
                            <button
                              onClick={handleConfirmFood}
                              disabled={isConfirming}
                              className="w-full bg-rose-500 text-white py-3.5 rounded-xl text-center text-sm font-bold shadow-md shadow-rose-500/30 transition-all hover:bg-rose-600 active:scale-[0.98] disabled:opacity-70 flex justify-center items-center gap-2"
                            >
                              {isConfirming ? "Memproses..." : `Jadi ke sini (- Rp ${result.price_tier.toLocaleString("id-ID")})`}
                            </button>
                      
                            {/* Simpan buat nanti — jawaban ketiga, bukan cuma
                                bookmark. "Belum sekarang, tapi menarik" adalah
                                sinyal yang berbeda dari menolak. */}
                            <button
                              onClick={handleSave}
                              disabled={isSaved}
                              className={`w-full rounded-xl py-3.5 text-sm font-semibold transition-all active:scale-[0.98] ${
                                isSaved
                                  ? "border border-amber-200 bg-amber-50 text-amber-700"
                                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              {isSaved ? (
                                <span className="inline-flex items-center justify-center gap-2">
                                  <BookmarkCheck className="h-4 w-4" aria-hidden="true" /> Tersimpan
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center gap-2">
                                  <Bookmark className="h-4 w-4" aria-hidden="true" /> Simpan buat nanti
                                </span>
                              )}
                            </button>

                            {/* Tombol Navigasi & Spin Ulang */}
                            <div className="flex flex-col sm:flex-row gap-3">
                              <Link
                                href={`/map?restaurant_id=${encodeURIComponent(result.id)}`}
                                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-slate-800 py-3.5 text-sm font-semibold !text-white shadow-sm transition-all hover:bg-slate-900 active:scale-[0.98]"
                              >
                                <MapPin className="h-4 w-4" aria-hidden="true" />{" "}
                                <span className="!text-white">Lihat di Peta</span>
                              </Link>
                              <button
                                onClick={handleSpin}
                                className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3.5 text-sm font-semibold text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 active:scale-[0.98]"
                              >
                                <RotateCw className="h-4 w-4" aria-hidden="true" /> Spin lagi
                              </button>
                            </div>

                            {/* Hasil gacha itu konten yang sudah jadi, dan
                                mahasiswa memutuskan makan beramai-ramai di
                                grup chat. Ini jalur distribusi termurah yang
                                kita punya. */}
                            <ShareResultButton
                              restaurantId={result.id}
                              name={result.name}
                              distanceMeters={result.distance}
                              priceTier={result.price_tier}
                            />
                          </>
                        )}
                      </div>
                      {/* AKHIR BAGIAN TOMBOL YANG DIUPDATE */}

                    </m.div>
                  ) : (
                    <m.div
                      key="empty-state"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"
                    >
                      <Dices className="mb-3 h-8 w-8 text-slate-300" aria-hidden="true" />
                      <p className="text-sm font-medium text-slate-400 max-w-sm leading-relaxed">
                        Belum ada hasil spin takdir. Silakan atur budget dan radius
                        pencarian, lalu tekan tombol SPIN di atas!
                      </p>
                    </m.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            <BottomNav />
          </main>
    </MotionProvider>
  );
}