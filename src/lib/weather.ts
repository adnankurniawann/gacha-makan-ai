/**
 * Konteks cuaca untuk `spin_events.is_raining`.
 *
 * Satu dimensi fitur di model yang belum ada. Nilainya nyata — orang memilih
 * makan berbeda saat hujan — tapi biayanya harus dijaga tetap nol di jalur
 * kritis: /api/spin tidak boleh melambat demi satu boolean.
 *
 * Karena itu aturannya sederhana: **tidak pernah menunggu.** Kalau cache-nya
 * dingin, kembalikan null dan segarkan di latar. Beberapa spin pertama pada
 * instance baru akan mencatat null, dan itu jauh lebih baik daripada membuat
 * semua orang menunggu jaringan.
 *
 * MATI SECARA DEFAULT. Nyalakan dengan `ENABLE_WEATHER_CONTEXT=true`. Fitur ini
 * memanggil layanan pihak ketiga (Open-Meteo), jadi keputusannya ada di tangan
 * yang men-deploy, bukan diam-diam menyala saat merge.
 */

/** Berapa lama satu pembacaan dianggap masih berlaku. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Pembulatan koordinat sebelum dikirim keluar, ~11 km.
 *
 * Dua alasan. Pertama privasi: lokasi persis pengguna tidak pernah dikirim ke
 * pihak ketiga. Kedua cache: seluruh Jatinangor jatuh ke kunci yang sama, jadi
 * hampir semua permintaan mengenai cache yang sudah hangat. Cuaca tidak
 * berbeda antar-RW.
 */
const COORD_PRECISION = 1;

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

interface CacheEntry {
  isRaining: boolean | null;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Set<string>();

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;
}

export function isWeatherContextEnabled(): boolean {
  return process.env.ENABLE_WEATHER_CONTEXT === "true";
}

/**
 * Mengambil satu pembacaan dari Open-Meteo.
 *
 * Diekspor supaya bisa diganti di test; bukan bagian dari API yang dipakai
 * route handler.
 */
export async function fetchIsRaining(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<boolean | null> {
  const url =
    `${ENDPOINT}?latitude=${lat.toFixed(COORD_PRECISION)}` +
    `&longitude=${lng.toFixed(COORD_PRECISION)}&current=precipitation`;

  const response = await fetch(url, { signal });
  if (!response.ok) return null;

  const payload: unknown = await response.json();
  const precipitation = (payload as { current?: { precipitation?: unknown } })
    ?.current?.precipitation;

  // Nilai yang tidak dikenali diperlakukan sebagai "tidak tahu", bukan "tidak
  // hujan". Menebak nol akan menanam fitur palsu ke dalam data latih.
  if (typeof precipitation !== "number" || !Number.isFinite(precipitation)) {
    return null;
  }

  return precipitation > 0;
}

/**
 * Menyegarkan cache di latar. Tidak pernah melempar.
 *
 * Dipanggil tanpa ditunggu, jadi errornya harus mati di sini — promise
 * rejection yang tidak tertangani bisa menjatuhkan proses di Node.
 */
export async function refreshWeather(lat: number, lng: number): Promise<void> {
  const key = cacheKey(lat, lng);

  // Satu permintaan per kunci. Tanpa penjaga ini, lonjakan spin saat jam makan
  // siang berubah jadi lonjakan permintaan ke layanan gratis orang lain.
  if (inFlight.has(key)) return;
  inFlight.add(key);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const isRaining = await fetchIsRaining(lat, lng, controller.signal);
    cache.set(key, { isRaining, fetchedAt: Date.now() });
  } catch {
    // Simpan kegagalannya sebagai null supaya tidak dicoba ulang tiap spin.
    cache.set(key, { isRaining: null, fetchedAt: Date.now() });
  } finally {
    clearTimeout(timeout);
    inFlight.delete(key);
  }
}

/**
 * Cuaca saat ini menurut cache. **Tidak pernah menunggu jaringan.**
 *
 * Mengembalikan `null` saat fiturnya mati, saat cache-nya dingin, atau saat
 * pembacaan terakhir gagal. Pemanggil harus menganggap null sebagai "tidak
 * tahu" — bukan "tidak hujan".
 *
 * Nilai yang dikembalikan bisa berumur sampai 10 menit. Untuk fitur seberapa
 * kasar "sedang hujan atau tidak", itu masih mewakili keadaan saat penayangan.
 */
export function currentIsRaining(lat: number, lng: number): boolean | null {
  if (!isWeatherContextEnabled()) return null;

  const entry = cache.get(cacheKey(lat, lng));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;

  return entry.isRaining;
}

/** `true` kalau cache untuk titik ini perlu disegarkan. */
export function needsRefresh(lat: number, lng: number): boolean {
  if (!isWeatherContextEnabled()) return false;

  const entry = cache.get(cacheKey(lat, lng));
  if (!entry) return true;

  return Date.now() - entry.fetchedAt > CACHE_TTL_MS;
}

/** Hanya untuk test. */
export function __resetWeatherCache(): void {
  cache.clear();
  inFlight.clear();
}
