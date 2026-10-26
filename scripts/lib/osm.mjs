/**
 * Helper murni untuk ingest OpenStreetMap.
 *
 * Semua fungsi di sini tanpa efek samping dan tanpa jaringan, supaya bisa
 * diuji tanpa memanggil Overpass. Orkestrasinya ada di scripts/ingest-osm.mjs.
 */

// ---------------------------------------------------------------------------
// Nama
// ---------------------------------------------------------------------------

/**
 * Kata yang muncul di hampir semua nama warung di sini dan karena itu tidak
 * membedakan apa pun. "Warung Nasi Ibu Imas" dan "Nasi Ibu Imas" adalah tempat
 * yang sama; yang membedakan tinggal "nasi ibu imas".
 */
const GENERIC_TOKENS = new Set([
  "warung", "waroeng", "warteg", "warkop", "wr",
  "rumah", "makan", "rm", "kedai", "depot", "kantin", "saung",
  "cafe", "kafe", "coffee", "kopi", "resto", "restoran", "restaurant",
  "the", "and", "dan",
]);

/** Nama daerah yang nyaris selalu ditempel dan sama untuk semua kandidat. */
const PLACE_TOKENS = new Set([
  "jatinangor", "bandung", "sumedang", "cikeruh", "hegarmanah",
  "unpad", "itb", "ipdn", "ikopin",
]);

/**
 * Menyederhanakan nama jadi bentuk yang bisa dibandingkan.
 *
 * Kalau setelah pembuangan token tidak tersisa apa-apa (misalnya nama aslinya
 * memang cuma "Warung Jatinangor"), kembalikan bentuk dasar tanpa pembuangan —
 * lebih baik membandingkan sesuatu daripada membandingkan string kosong, yang
 * akan cocok dengan semua nama kosong lainnya.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeName(name) {
  if (typeof name !== "string") return "";

  const base = name
    .normalize("NFD") // pisahkan huruf dari tanda diakritiknya
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Apostrof adalah elisi di tengah kata ("D'cota", "Mc'Donald"), bukan
    // pemisah — dibuang, bukan diganti spasi. Tanda baca lain memisahkan.
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (base === "") return "";

  const kept = base
    .split(" ")
    .filter((token) => !GENERIC_TOKENS.has(token) && !PLACE_TOKENS.has(token));

  return kept.length > 0 ? kept.join(" ") : base;
}

/**
 * Kemiripan dua string lewat koefisien Dice atas bigram huruf.
 *
 * Dipilih daripada Levenshtein karena tahan terhadap perbedaan urutan kata —
 * "ayam geprek pak budi" vs "geprek pak budi ayam" tetap dianggap mirip,
 * sementara Levenshtein akan menghukumnya berat.
 *
 * @returns {number} 0 (tidak mirip) sampai 1 (identik)
 */
export function similarity(a, b) {
  if (a === b) return a === "" ? 0 : 1;
  if (a.length < 2 || b.length < 2) return 0;

  /** @param {string} value */
  const bigrams = (value) => {
    const map = new Map();
    for (let index = 0; index < value.length - 1; index += 1) {
      const pair = value.slice(index, index + 2);
      map.set(pair, (map.get(pair) ?? 0) + 1);
    }
    return map;
  };

  const left = bigrams(a);
  const right = bigrams(b);

  let shared = 0;
  for (const [pair, count] of left) {
    shared += Math.min(count, right.get(pair) ?? 0);
  }

  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

// ---------------------------------------------------------------------------
// Jarak
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Jarak haversine dalam meter. Cukup akurat untuk jarak ratusan meter, dan
 * tidak butuh PostGIS — dedup berjalan sebelum data masuk database.
 */
export function haversineMeters(aLat, aLng, bLat, bLng) {
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// Deduplikasi
// ---------------------------------------------------------------------------

/**
 * Ambang kecocokan. Semakin dekat jaraknya, semakin longgar nama boleh berbeda
 * — dua titik dalam radius 40 meter dengan nama yang mirip hampir pasti tempat
 * yang sama, sedangkan pada 150 meter namanya harus benar-benar mirip supaya
 * dua warung bersebelahan yang berbeda tidak ikut tergabung.
 */
export const DEDUPE_RULES = [
  { withinMeters: 40, minSimilarity: 0.6 },
  { withinMeters: 150, minSimilarity: 0.85 },
];

/**
 * Mencari padanan satu kandidat di antara data yang sudah ada.
 *
 * @param {{name: string, lat: number, lng: number, osmId?: string|null}} candidate
 * @param {Array<{id?: string, name: string, lat: number, lng: number, osm_id?: string|null}>} existing
 * @returns {{match: object, reason: string, distance: number, score: number}|null}
 */
export function findDuplicate(candidate, existing) {
  // Jalur paling pasti: baris yang memang berasal dari objek OSM yang sama.
  if (candidate.osmId) {
    const byOsmId = existing.find((row) => row.osm_id === candidate.osmId);
    if (byOsmId) {
      return { match: byOsmId, reason: "osm_id", distance: 0, score: 1 };
    }
  }

  const candidateName = normalizeName(candidate.name);
  if (candidateName === "") return null;

  let best = null;

  for (const row of existing) {
    const distance = haversineMeters(
      candidate.lat,
      candidate.lng,
      row.lat,
      row.lng,
    );

    const widest = DEDUPE_RULES[DEDUPE_RULES.length - 1].withinMeters;
    if (distance > widest) continue;

    const rowName = normalizeName(row.name);
    if (rowName === "") continue;

    const score = similarity(candidateName, rowName);

    const rule = DEDUPE_RULES.find(
      (candidateRule) =>
        distance <= candidateRule.withinMeters &&
        score >= candidateRule.minSimilarity,
    );
    if (!rule) continue;

    // Kalau beberapa baris memenuhi syarat, ambil yang namanya paling mirip;
    // jarak jadi penentu kedua.
    if (
      best === null ||
      score > best.score ||
      (score === best.score && distance < best.distance)
    ) {
      best = {
        match: row,
        reason: `nama ${score.toFixed(2)} @ ${Math.round(distance)}m`,
        distance,
        score,
      };
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Jam buka OSM
// ---------------------------------------------------------------------------

const DAY_INDEX = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };

/** Aturan yang tidak dipetakan ke hari biasa; diabaikan, bukan digagalkan. */
const IGNORABLE_SELECTORS = /^(ph|sh|easter)\b/i;

function expandDays(spec) {
  const days = new Set();

  for (const group of spec.split(",")) {
    const range = group.trim().toLowerCase();
    if (range === "") return null;

    const [from, to] = range.split("-");
    const start = DAY_INDEX[from];
    if (start === undefined) return null;

    if (to === undefined) {
      days.add(start);
      continue;
    }

    const end = DAY_INDEX[to];
    if (end === undefined) return null;

    // Sa-Su membungkus lewat akhir pekan.
    for (let day = start; ; day = (day + 1) % 7) {
      days.add(day);
      if (day === end) break;
    }
  }

  return [...days];
}

function parseClock(value) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 24 || minutes > 59) return null;
  if (hours === 24 && minutes !== 0) return null;

  return `${String(hours).padStart(2, "0")}:${match[2]}:00`;
}

/**
 * Menerjemahkan tag `opening_hours` OSM ke baris tabel opening_hours.
 *
 * Sintaks OSM jauh lebih kaya daripada yang ditangani di sini. Yang didukung:
 * `24/7`, `Mo-Fr 08:00-17:00`, beberapa rentang dipisah koma, beberapa aturan
 * dipisah titik koma, dan `off`/`closed`.
 *
 * Begitu ada satu bagian yang tidak dikenali, SELURUH string ditolak dan
 * fungsi mengembalikan null. Ini disengaja: jam buka yang separuh benar lebih
 * berbahaya daripada jam buka yang kosong — yang kosong akan masuk antrean
 * kurasi, yang separuh benar akan diam-diam menyesatkan orang.
 *
 * @param {string} value - isi tag opening_hours
 * @returns {Array<{day_of_week: number, opens_at: string, closes_at: string, crosses_midnight: boolean}>|null}
 */
export function parseOpeningHours(value) {
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (raw === "") return null;

  if (/^24\s*\/\s*7$/.test(raw)) {
    return [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day_of_week: day,
      opens_at: "00:00:00",
      closes_at: "24:00:00",
      crosses_midnight: false,
    }));
  }

  /** @type {Map<string, object>} */
  const rows = new Map();

  for (const rule of raw.split(";")) {
    const text = rule.trim();
    if (text === "") continue;
    if (IGNORABLE_SELECTORS.test(text)) continue;

    const match = text.match(/^([A-Za-z,\-]+)\s+(.+)$/);
    if (!match) return null;

    const days = expandDays(match[1]);
    if (days === null) return null;

    const times = match[2].trim().toLowerCase();

    if (times === "off" || times === "closed") {
      // Hari libur: cukup tidak menghasilkan baris. Baris yang mungkin sudah
      // dibuat aturan sebelumnya untuk hari ini dibatalkan.
      for (const day of days) {
        for (const key of [...rows.keys()]) {
          if (key.startsWith(`${day}|`)) rows.delete(key);
        }
      }
      continue;
    }

    for (const span of times.split(",")) {
      const bounds = span.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      if (!bounds) return null;

      const opensAt = parseClock(bounds[1]);
      const closesAt = parseClock(bounds[2]);
      if (opensAt === null || closesAt === null) return null;

      for (const day of days) {
        rows.set(`${day}|${opensAt}`, {
          day_of_week: day,
          opens_at: opensAt,
          closes_at: closesAt,
          crosses_midnight: closesAt <= opensAt,
        });
      }
    }
  }

  if (rows.size === 0) return null;

  return [...rows.values()].sort(
    (a, b) =>
      a.day_of_week - b.day_of_week || a.opens_at.localeCompare(b.opens_at),
  );
}

// ---------------------------------------------------------------------------
// Kategori
// ---------------------------------------------------------------------------

/**
 * Peta cuisine OSM ke kategori yang dipakai aplikasi. Sengaja memakai istilah
 * yang sama dengan data seed supaya keduanya bisa bercampur tanpa migrasi.
 */
const CUISINE_MAP = {
  chicken: "Ayam",
  fried_chicken: "Ayam",
  noodle: "Mie",
  ramen: "Mie",
  indonesian: "Nusantara",
  sundanese: "Sunda",
  padang: "Padang",
  javanese: "Nusantara",
  seafood: "Seafood",
  fish: "Seafood",
  bakery: "Roti",
  cake: "Roti",
  coffee_shop: "Kopi",
  ice_cream: "Manis",
  dessert: "Manis",
  pizza: "Barat",
  burger: "Barat",
  sandwich: "Barat",
  steak_house: "Barat",
  american: "Barat",
  italian: "Barat",
  western: "Barat",
  chinese: "Chinese",
  dim_sum: "Chinese",
  japanese: "Jepang",
  sushi: "Jepang",
  korean: "Korea",
  thai: "Thailand",
  asian: "Asia",
  bubble_tea: "Minuman",
  juice: "Minuman",
  regional: "Nusantara",
};

const AMENITY_FALLBACK = {
  restaurant: "Restoran",
  fast_food: "Cepat Saji",
  cafe: "Kopi",
  food_court: "Foodcourt",
  ice_cream: "Manis",
};

/**
 * Kategori terbaik yang bisa disimpulkan dari tag OSM, atau null kalau tidak
 * ada petunjuk sama sekali. Null lebih jujur daripada menebak, dan barisnya
 * akan muncul di antrean kurasi.
 */
export function categoryFromTags(tags = {}) {
  const cuisines = String(tags.cuisine ?? "")
    .toLowerCase()
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const cuisine of cuisines) {
    if (CUISINE_MAP[cuisine]) return CUISINE_MAP[cuisine];
  }

  return AMENITY_FALLBACK[tags.amenity] ?? null;
}

// ---------------------------------------------------------------------------
// Elemen Overpass -> kandidat
// ---------------------------------------------------------------------------

/**
 * Mengubah satu elemen Overpass jadi kandidat, atau null kalau tidak layak
 * dipakai (tanpa nama atau tanpa koordinat).
 */
export function toCandidate(element) {
  const tags = element?.tags ?? {};
  const name = typeof tags.name === "string" ? tags.name.trim() : "";
  if (name === "") return null;

  // Node punya lat/lon langsung; way dan relation memakai `center` dari
  // Overpass (`out center`).
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const addressParts = [
    tags["addr:street"],
    tags["addr:housenumber"],
    tags["addr:village"] ?? tags["addr:suburb"],
  ].filter(Boolean);

  return {
    osmId: `${element.type}/${element.id}`,
    name,
    lat,
    lng,
    category: categoryFromTags(tags),
    address: addressParts.length > 0 ? addressParts.join(" ") : null,
    openingHours: parseOpeningHours(tags.opening_hours ?? ""),
    // OSM praktis tidak pernah punya harga. Dibiarkan null supaya masuk
    // antrean kurasi, bukan ditebak dengan angka karangan.
    priceTier: null,
    rawOpeningHours: tags.opening_hours ?? null,
  };
}
