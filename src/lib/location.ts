/**
 * Pilihan lokasi pengguna, dan ingatannya.
 *
 * Sebagian besar orang menolak permintaan lokasi pertama kali. Aplikasi yang
 * mentok di layar putih saat izin ditolak akan langsung ditutup dan tidak
 * dibuka lagi. Jadi lokasi manual bukan jalur darurat di sini — ia jalur yang
 * setara, dan pilihan terakhir selalu diingat supaya tidak perlu diulang.
 */

export interface AreaPreset {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

/**
 * Titik acuan area di sekitar Jatinangor.
 *
 * PERHATIAN: koordinat ini perkiraan pusat kawasan, bukan hasil survei. Untuk
 * radius pencarian 500–5000 m selisih beberapa ratus meter tidak mengubah
 * hasil secara berarti, tapi verifikasi lewat peta sebelum dipakai luas —
 * terutama kalau nanti radius terkecil diperkecil lagi.
 */
export const AREA_PRESETS: readonly AreaPreset[] = [
  { id: "kampus", label: "Kampus", lat: -6.9262, lng: 107.7717 },
  { id: "sayang", label: "Sayang", lat: -6.9328, lng: 107.7695 },
  { id: "hegarmanah", label: "Hegarmanah", lat: -6.9295, lng: 107.778 },
  { id: "cikeruh", label: "Cikeruh", lat: -6.935, lng: 107.7745 },
  { id: "cibeusi", label: "Cibeusi", lat: -6.9218, lng: 107.769 },
];

/** Dipakai kalau belum ada pilihan apa pun. */
export const DEFAULT_AREA = AREA_PRESETS[0];

export type LocationSource = "gps" | "area";

export interface LocationChoice {
  source: LocationSource;
  lat: number;
  lng: number;
  /** Hanya terisi kalau `source` adalah "area". */
  areaId?: string;
}

const STORAGE_KEY = "gacha-makan:lokasi";

function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Membaca pilihan terakhir. Mengembalikan null kalau belum ada, tidak bisa
 * dibaca, atau isinya sudah tidak masuk akal.
 *
 * localStorage bisa berisi apa saja: sisa versi lama, hasil orang mengetik di
 * console, atau data yang rusak. Semuanya diperlakukan sebagai "belum ada
 * pilihan" — lebih baik bertanya sekali lagi daripada mengirim koordinat
 * ngawur ke pencarian.
 */
export function readSavedLocation(): LocationChoice | null {
  if (typeof window === "undefined") return null;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Mode privat di sebagian browser melempar saat localStorage disentuh.
    return null;
  }

  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;

    const value = parsed as Record<string, unknown>;
    if (value.source !== "gps" && value.source !== "area") return null;
    if (!isValidCoordinate(value.lat, value.lng)) return null;

    return {
      source: value.source,
      lat: value.lat as number,
      lng: value.lng as number,
      areaId: typeof value.areaId === "string" ? value.areaId : undefined,
    };
  } catch {
    return null;
  }
}

/** Menyimpan pilihan. Gagal menyimpan tidak boleh menggagalkan apa pun. */
export function saveLocation(choice: LocationChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Kuota penuh atau storage diblokir. Pilihannya tetap berlaku untuk sesi
    // ini, cuma tidak diingat lain kali.
  }
}

export function clearSavedLocation(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sama seperti di atas: tidak ada yang perlu digagalkan.
  }
}

export function findArea(areaId: string | undefined): AreaPreset | null {
  if (!areaId) return null;
  return AREA_PRESETS.find((area) => area.id === areaId) ?? null;
}

/** Label untuk ditampilkan, apa pun asal koordinatnya. */
export function describeLocation(choice: LocationChoice | null): string {
  if (choice === null) return "Belum dipilih";
  if (choice.source === "gps") return "Lokasi kamu sekarang";
  return findArea(choice.areaId)?.label ?? "Area pilihan";
}

export type PermissionState = "granted" | "denied" | "prompt" | "unknown";

/**
 * Status izin lokasi TANPA memicu prompt browser.
 *
 * Ini yang membuat kita bisa menjelaskan alasannya lebih dulu: kalau izinnya
 * belum pernah ditanyakan, tampilkan penjelasan; kalau sudah ditolak, langsung
 * ke pemilih area tanpa memancing dialog yang pasti gagal lagi.
 *
 * Permissions API tidak ada di semua browser (Safari lama), dan di sana
 * jawabannya "unknown" — pemanggil harus tetap punya jalur untuk itu.
 */
export async function readPermissionState(): Promise<PermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unknown";
  }

  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "unknown";
  }
}
