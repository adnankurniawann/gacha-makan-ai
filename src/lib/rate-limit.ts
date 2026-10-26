/**
 * Rate limiting untuk route handler.
 *
 * Sliding window sederhana yang disimpan di memori proses. Tujuannya menahan
 * satu skrip yang menembak /api/spin ribuan kali dan menghabiskan kuota
 * Supabase semalam — bukan menahan penyerang terdistribusi.
 *
 * Batasannya, dan ini perlu diketahui sebelum diandalkan:
 *   - Hitungannya per instance. Di Vercel, tiap serverless instance punya
 *     Map sendiri, jadi batas efektifnya = limit x jumlah instance aktif.
 *   - Reset saat cold start.
 * Kalau nanti trafiknya cukup besar untuk membuat ini jadi masalah, pindahkan
 * penyimpanannya ke Redis/Upstash tanpa mengubah tanda tangan fungsinya.
 */

/** Timestamp (ms) permintaan yang masih di dalam window, per kunci. */
const windows = new Map<string, number[]>();

/** Kunci yang tidak tersentuh selama ini dianggap mati dan boleh dibuang. */
const IDLE_EVICTION_MS = 10 * 60 * 1000;

let lastSweep = 0;

/**
 * Membuang kunci yang sudah lama tidak dipakai supaya Map tidak tumbuh
 * mengikuti jumlah IP unik seumur hidup proses.
 */
function sweep(now: number): void {
  if (now - lastSweep < IDLE_EVICTION_MS) return;
  lastSweep = now;

  for (const [key, hits] of windows) {
    const newest = hits[hits.length - 1];
    if (newest === undefined || now - newest > IDLE_EVICTION_MS) {
      windows.delete(key);
    }
  }
}

export interface RateLimitResult {
  /** `false` berarti pemanggil harus dibalas 429. */
  allowed: boolean;
  /** Sisa jatah di window saat ini. */
  remaining: number;
  /** Detik sampai jatah berikutnya tersedia. `0` kalau masih boleh. */
  retryAfterSeconds: number;
}

/**
 * Mencatat satu permintaan untuk `key` dan memutuskan boleh atau tidak.
 *
 * @param key      - Pengenal pemanggil, biasanya `${route}:${ip}`
 * @param limit    - Jumlah permintaan maksimum dalam satu window
 * @param windowMs - Panjang window dalam milidetik
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const cutoff = now - windowMs;
  const hits = (windows.get(key) ?? []).filter((at) => at > cutoff);

  if (hits.length >= limit) {
    windows.set(key, hits);
    // hits[0] adalah yang paling lama; jatah bebas saat ia keluar window.
    const retryAfterMs = hits[0] + windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  hits.push(now);
  windows.set(key, hits);

  return {
    allowed: true,
    remaining: limit - hits.length,
    retryAfterSeconds: 0,
  };
}

/**
 * IP pemanggil menurut header proxy.
 *
 * Nilainya tidak bisa dipercaya sepenuhnya — di belakang proxy yang benar,
 * entri pertama x-forwarded-for adalah klien, tapi klien bisa menambahkan
 * entri palsu. Cukup untuk membedakan pengguna biasa, tidak cukup sebagai
 * kontrol keamanan.
 */
export function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  if (first) return first;

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Header standar supaya klien tahu kapan boleh mencoba lagi. */
export function rateLimitHeaders(
  result: RateLimitResult,
  limit: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(result.remaining),
  };
  if (!result.allowed) {
    headers["Retry-After"] = String(result.retryAfterSeconds);
  }
  return headers;
}

/** Hanya untuk test — mengosongkan state antar kasus uji. */
export function __resetRateLimits(): void {
  windows.clear();
  lastSweep = 0;
}
