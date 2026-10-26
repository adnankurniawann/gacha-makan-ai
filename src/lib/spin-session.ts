/**
 * Identitas sesi spin dan filter yang diingat.
 *
 * Keduanya hidup di browser dan sengaja dipisah tempat penyimpanannya:
 *
 *   sessionStorage  session_id  — satu duduk. Menutup tab memulai sesi baru,
 *                                 dan itu memang yang ingin diukur: berapa
 *                                 spin sampai seseorang puas dalam satu kali
 *                                 mencari makan.
 *   localStorage    filter      — bertahan antar kunjungan. Mengatur ulang
 *                                 radius dan budget tiap kali buka adalah
 *                                 gesekan yang tidak perlu.
 */

const SESSION_KEY = "gacha-makan:sesi-spin";
const FILTER_KEY = "gacha-makan:filter";

/** UUID acak, dengan cadangan untuk browser tanpa crypto.randomUUID. */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Cadangan: cukup untuk mengelompokkan sesi, bukan untuk keamanan.
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) =>
    char === "x" ? hex() : ((Math.floor(Math.random() * 4) + 8).toString(16)),
  );
}

/**
 * Id sesi untuk duduk ini, dibuat sekali lalu dipakai ulang.
 *
 * Mengembalikan `null` di server dan saat storage diblokir. Pemanggil harus
 * tetap bisa spin tanpa itu — yang hilang cuma pengelompokan datanya.
 */
export function getSpinSessionId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;

    const created = newId();
    window.sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return null;
  }
}

export interface SavedFilters {
  budget: number;
  radius: number;
  onlyOpen: boolean;
}

/**
 * Filter tersimpan, atau `null` kalau belum ada / isinya tidak masuk akal.
 *
 * Divalidasi terhadap batas yang sama dengan slider. Nilai di luar rentang
 * akan membuat slider tampil di posisi yang tidak sesuai dengan angka yang
 * benar-benar dikirim ke API — persis jenis ketidakcocokan yang membingungkan
 * dan sulit dilacak.
 */
export function readSavedFilters(bounds: {
  budgetMin: number;
  budgetMax: number;
  radiusMin: number;
  radiusMax: number;
}): SavedFilters | null {
  if (typeof window === "undefined") return null;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(FILTER_KEY);
  } catch {
    return null;
  }

  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;

    const value = parsed as Record<string, unknown>;
    const { budget, radius, onlyOpen } = value;

    if (typeof budget !== "number" || !Number.isFinite(budget)) return null;
    if (typeof radius !== "number" || !Number.isFinite(radius)) return null;
    if (typeof onlyOpen !== "boolean") return null;

    if (budget < bounds.budgetMin || budget > bounds.budgetMax) return null;
    if (radius < bounds.radiusMin || radius > bounds.radiusMax) return null;

    return { budget, radius, onlyOpen };
  } catch {
    return null;
  }
}

/** Menyimpan filter. Gagal menyimpan tidak boleh menggagalkan apa pun. */
export function saveFilters(filters: SavedFilters): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  } catch {
    // Kuota penuh atau storage diblokir; filternya tetap berlaku sesi ini.
  }
}
