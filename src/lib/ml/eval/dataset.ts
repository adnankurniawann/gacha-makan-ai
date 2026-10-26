/**
 * Test set kategorisasi dari OpenStreetMap — bagian yang murni.
 *
 * Tag `cuisine` OSM diisi manusia, jadi bisa dipakai sebagai label "asli" untuk
 * menilai tebakan kategori dari nama. Tapi tagnya tidak bersih: ada 700+ nilai
 * berbeda, seperempatnya multi-nilai, dan banyak yang bukan masakan sama
 * sekali ("local", "breakfast", "international"). Karena itu label emas
 * ditentukan oleh pedoman eksplisit di `GOLD_MAP`, bukan oleh pencocokan kata
 * kunci — pedoman yang bisa dibaca dan dibantah, sama seperti pedoman anotasi
 * untuk anotator manusia.
 */

import { createRng } from "@/lib/ml/linalg";
import { CUISINE_SLOTS, toCuisineSlot, type CuisineSlot } from "@/lib/ml/taxonomy";

/** Satu tempat dari snapshot OSM. */
export interface OsmPlace {
  /** Jenis + id OSM, mis. "n123" untuk node 123. */
  osm: string;
  name: string;
  /** Tag `cuisine` mentah, bisa multi-nilai dengan `;`. */
  cuisine: string;
  amenity: string;
}

export interface OsmSnapshot {
  source: string;
  license: string;
  /** Waktu data OSM yang dibaca Overpass. */
  osmBase: string;
  query: string;
  places: OsmPlace[];
}

/**
 * Pedoman label: nilai `cuisine` OSM → slot.
 *
 * - Slot: nilai itu jelas menunjuk satu slot.
 * - `null`: bukan masakan, atau terlalu umum untuk ditentukan ("asian" bisa
 *   Chinese, Jepang, atau Thai). Diabaikan; kalau hanya itu isinya, barisnya
 *   dibuang.
 * - Tidak ada di daftar: barisnya dibuang dan dihitung. Lebih baik test set
 *   lebih kecil daripada label yang ditebak.
 *
 * Keputusan yang bisa diperdebatkan, ditulis supaya tidak tersembunyi:
 * - Ayam goreng cepat saji (KFC) masuk `ayam`, sama dengan `toCuisineSlot`
 *   yang memetakan "Chicken restaurant" ke `ayam`.
 * - Ramen masuk `mie`, juga mengikuti `toCuisineSlot` dan ingest OSM.
 * - Masakan daerah selain Sunda dan Padang (Bali, Aceh, Tegal) masuk
 *   `nusantara`.
 * - `nusantara` + satu slot spesifik → slot spesifiknya (lihat `goldSlot`).
 * - Masakan Eropa masuk `barat`; masakan asing lain (Thai, India, Meksiko,
 *   Timur Tengah) masuk `lainnya` — memang tidak ada slotnya.
 */
export const GOLD_MAP: Record<string, CuisineSlot | null> = {
  // ayam
  chicken: "ayam",
  fried_chicken: "ayam",
  wings: "ayam",
  ayam: "ayam",
  ayam_goreng: "ayam",
  ayam_geprek: "ayam",
  ayam_penyet: "ayam",
  geprek: "ayam",
  ayam_bakar: "ayam",
  // mie
  noodle: "mie",
  noodles: "mie",
  ramen: "mie",
  bakso: "mie",
  meatball: "mie",
  mie_ayam: "mie",
  mie: "mie",
  mi: "mie",
  bakmi: "mie",
  udon: "mie",
  meatballs: "mie",
  meat_ball: "mie",
  indomie: "mie",
  // nusantara
  indonesian: "nusantara",
  regional: "nusantara",
  daerahregional: "nusantara",
  javanese: "nusantara",
  soto: "nusantara",
  satay: "nusantara",
  sate: "nusantara",
  pecel: "nusantara",
  pecel_lele: "nusantara",
  nasi_goreng: "nusantara",
  fried_rice: "nusantara",
  tegalan: "nusantara",
  warteg: "nusantara",
  balinese: "nusantara",
  acehnese: "nusantara",
  betawi: "nusantara",
  manado: "nusantara",
  porridge: "nusantara",
  bubur: "nusantara",
  gudeg: "nusantara",
  rawon: "nusantara",
  indonesia: "nusantara",
  soto_ayam: "nusantara",
  pempek: "nusantara",
  lontong: "nusantara",
  "gado-gado": "nusantara",
  tahu_campur: "nusantara",
  cirebonese: "nusantara",
  // sunda
  sundanese: "sunda",
  sunda: "sunda",
  // padang
  padang: "padang",
  minang: "padang",
  minangkabau: "padang",
  masakan_padang: "padang",
  nasi_padang: "padang",
  padangnese: "padang",
  // chinese
  chinese: "chinese",
  dim_sum: "chinese",
  dimsum: "chinese",
  cantonese: "chinese",
  // jepang_korea
  japanese: "jepang_korea",
  sushi: "jepang_korea",
  korean: "jepang_korea",
  beef_bowl: "jepang_korea",
  teppanyaki: "jepang_korea",
  // barat
  burger: "barat",
  pizza: "barat",
  italian_pizza: "barat",
  sandwich: "barat",
  steak_house: "barat",
  steak: "barat",
  american: "barat",
  italian: "barat",
  western: "barat",
  pasta: "barat",
  fish_and_chips: "barat",
  hot_dog: "barat",
  fries: "barat",
  french: "barat",
  german: "barat",
  spanish: "barat",
  greek: "barat",
  european: "barat",
  // seafood
  seafood: "seafood",
  fish: "seafood",
  // kopi_minuman
  coffee_shop: "kopi_minuman",
  coffee: "kopi_minuman",
  kopi: "kopi_minuman",
  cafe: "kopi_minuman",
  tea: "kopi_minuman",
  bubble_tea: "kopi_minuman",
  juice: "kopi_minuman",
  drinks: "kopi_minuman",
  drink: "kopi_minuman",
  minuman: "kopi_minuman",
  boba: "kopi_minuman",
  es_teh: "kopi_minuman",
  milk: "kopi_minuman",
  smoothie: "kopi_minuman",
  // manis_roti
  ice_cream: "manis_roti",
  donut: "manis_roti",
  cake: "manis_roti",
  dessert: "manis_roti",
  pastry: "manis_roti",
  bakery: "manis_roti",
  bread: "manis_roti",
  bagel: "manis_roti",
  pancake: "manis_roti",
  crepe: "manis_roti",
  waffle: "manis_roti",
  martabak: "manis_roti",
  frozen_yogurt: "manis_roti",
  chocolate: "manis_roti",
  gelato: "manis_roti",
  brownies: "manis_roti",
  // lainnya: masakan nyata yang tidak punya slot
  thai: "lainnya",
  indian: "lainnya",
  mexican: "lainnya",
  kebab: "lainnya",
  arab: "lainnya",
  middle_eastern: "lainnya",
  turkish: "lainnya",
  lebanese: "lainnya",
  vietnamese: "lainnya",
  malaysian: "lainnya",
  russian: "lainnya",
  filipino: "lainnya",
  // diabaikan: bukan masakan atau terlalu umum
  asian: null,
  local: null,
  international: null,
  breakfast: null,
  lunch: null,
  brunch: null,
  diner: null,
  grill: null,
  barbecue: null,
  fast_food: null,
  snack: null,
  fine_dining: null,
  traditional: null,
  rice: null,
  salad: null,
  soup: null,
  deli: null,
  oriental: null,
  beef: null,
  pork: null,
  sausage: null,
  friture: null,
  fried_food: null,
  curry: null,
  mediterranean: null,
  vegetarian: null,
  vegan: null,
  halal: null,
};

export type DropReason =
  | "tidak_dipetakan" // ada nilai cuisine yang tidak ada di pedoman
  | "hanya_umum" // semua nilainya diabaikan
  | "multi_slot" // nilai-nilainya menunjuk slot berbeda
  | "label_bertentangan"; // nama yang sama, label berbeda di tempat berbeda

export type GoldResult = { slot: CuisineSlot } | { drop: DropReason };

/** Label emas untuk satu nilai tag `cuisine`. */
export function goldSlot(cuisine: string): GoldResult {
  const values = cuisine
    .toLowerCase()
    .split(";")
    .map((value) => value.trim().replace(/\s+/g, "_"))
    .filter(Boolean);

  const slots = new Set<CuisineSlot>();
  for (const value of values) {
    if (!(value in GOLD_MAP)) return { drop: "tidak_dipetakan" };
    const slot = GOLD_MAP[value];
    if (slot) slots.add(slot);
  }

  if (slots.size === 0) return { drop: "hanya_umum" };
  // `nusantara` adalah "masakan Indonesia" secara umum. Digabung dengan satu
  // slot yang lebih spesifik ("indonesian;sundanese"), yang spesifik menang —
  // urutan yang sama dengan `toCuisineSlot`, yang mencocokkan nusantara
  // paling akhir.
  if (slots.size === 2 && slots.has("nusantara")) slots.delete("nusantara");
  // "chicken;burger" bisa ayam, bisa barat. Memilih salah satu berarti
  // menghukum model untuk ambiguitas yang ada di labelnya.
  if (slots.size > 1) return { drop: "multi_slot" };
  return { slot: [...slots][0] };
}

/** Bentuk nama untuk deduplikasi: huruf kecil, tanpa diakritik dan tanda baca. */
export function normalizeEvalName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** FNV-1a 32-bit, dipetakan ke [0, 1). */
function hashUnit(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 2 ** 32;
}

export type Split = "train" | "dev" | "test";

export interface EvalItem {
  /** Id OSM kemunculan pertama; dipakai sebagai id di prompt. */
  id: string;
  name: string;
  gold: CuisineSlot;
  split: Split;
  /** Nama yang muncul ≥ `chainMin` kali di snapshot (KFC, Starbucks, …). */
  chain: boolean;
  /** Nama tanpa kata kunci masakan: `toCuisineSlot(name)` jatuh ke `lainnya`. */
  hard: boolean;
}

export interface DatasetStats {
  places: number;
  dropped: Record<DropReason, number>;
  /** Nama unik yang tersisa. */
  items: number;
  bySplit: Record<Split, number>;
}

export interface DatasetOptions {
  /** Porsi dev dan test; sisanya train. */
  devFraction?: number;
  testFraction?: number;
  /** Nama yang muncul sesering ini dianggap jaringan waralaba. */
  chainMin?: number;
  /** Porsi label mayoritas minimum supaya nama yang berulang tetap dipakai. */
  agreement?: number;
}

/**
 * Snapshot → satu item per nama unik, dengan split yang deterministik.
 *
 * - **Dedup per nama.** "KFC" muncul ratusan kali; tanpa dedup, test set
 *   didominasi segelintir merek dan pengklasifikasi yang dilatih cukup
 *   menghafal nama.
 * - **Split dari hash nama, bukan pengacakan.** Nama yang sama selalu jatuh ke
 *   split yang sama, termasuk saat snapshot diperbarui — test set tidak
 *   pernah bocor ke train.
 */
export function buildDataset(
  snapshot: OsmSnapshot,
  options: DatasetOptions = {},
): { items: EvalItem[]; stats: DatasetStats } {
  const devFraction = options.devFraction ?? 0.1;
  const testFraction = options.testFraction ?? 0.2;
  const chainMin = options.chainMin ?? 3;
  const agreement = options.agreement ?? 0.7;

  const dropped: Record<DropReason, number> = {
    tidak_dipetakan: 0,
    hanya_umum: 0,
    multi_slot: 0,
    label_bertentangan: 0,
  };

  interface Group {
    id: string;
    name: string;
    occurrences: number;
    votes: Map<CuisineSlot, number>;
  }
  const groups = new Map<string, Group>();

  for (const place of snapshot.places) {
    const key = normalizeEvalName(place.name);
    if (key === "") continue;

    let group = groups.get(key);
    if (!group) {
      group = { id: place.osm, name: place.name.trim(), occurrences: 0, votes: new Map() };
      groups.set(key, group);
    }
    group.occurrences += 1;

    const result = goldSlot(place.cuisine);
    if ("drop" in result) {
      dropped[result.drop] += 1;
      continue;
    }
    group.votes.set(result.slot, (group.votes.get(result.slot) ?? 0) + 1);
  }

  const items: EvalItem[] = [];
  for (const [key, group] of groups) {
    const total = [...group.votes.values()].reduce((sum, n) => sum + n, 0);
    if (total === 0) continue;

    const [slot, count] = [...group.votes].sort((a, b) => b[1] - a[1])[0];
    if (count / total < agreement) {
      dropped.label_bertentangan += total;
      continue;
    }

    const u = hashUnit(key);
    const split: Split = u < testFraction ? "test" : u < testFraction + devFraction ? "dev" : "train";

    items.push({
      id: group.id,
      name: group.name,
      gold: slot,
      split,
      chain: group.occurrences >= chainMin,
      hard: toCuisineSlot(group.name) === "lainnya",
    });
  }

  items.sort((a, b) => a.id.localeCompare(b.id));

  const bySplit: Record<Split, number> = { train: 0, dev: 0, test: 0 };
  for (const item of items) bySplit[item.split] += 1;

  return {
    items,
    stats: { places: snapshot.places.length, dropped, items: items.length, bySplit },
  };
}

/**
 * Sampel berimbang: paling banyak `perClass` item per slot, deterministik.
 *
 * Dipakai untuk subset yang dikirim ke LLM. Distribusi aslinya didominasi
 * `nusantara` dan `kopi_minuman`; tanpa pembatasan, akurasi tinggi bisa
 * didapat cukup dengan menebak kelas mayoritas, dan kelas kecil seperti
 * `padang` hampir tidak terukur.
 */
export function sampleBalanced(items: EvalItem[], perClass: number, seed: number): EvalItem[] {
  const rng = createRng(seed);
  const picked: EvalItem[] = [];

  for (const slot of CUISINE_SLOTS) {
    const pool = items.filter((item) => item.gold === slot);
    // Fisher–Yates parsial.
    for (let i = 0; i < Math.min(perClass, pool.length); i += 1) {
      const j = i + Math.floor(rng() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      picked.push(pool[i]);
    }
  }

  return picked.sort((a, b) => a.id.localeCompare(b.id));
}
