/**
 * Menyatukan dua kosakata kategori yang hidup berdampingan di kolom yang sama.
 *
 * Data seed memakai istilah gaya Google Maps dalam bahasa Inggris
 * ("Sundanese restaurant", "Coffee shop"), sedangkan ingest OpenStreetMap
 * menghasilkan istilah Indonesia ("Sunda", "Kopi"). Model tidak boleh melihat
 * keduanya sebagai hal yang berbeda hanya karena bahasanya berbeda.
 *
 * Daftar slotnya sengaja pendek dan tetap. One-hot yang tumbuh mengikuti isi
 * database akan mengubah panjang vektor fitur setiap kali ada kategori baru,
 * dan model yang sudah dilatih langsung tidak cocok lagi.
 */

/** Slot kategori. Urutannya menentukan posisi one-hot — jangan diubah-ubah. */
export const CUISINE_SLOTS = [
  "ayam",
  "mie",
  "nusantara",
  "sunda",
  "padang",
  "chinese",
  "jepang_korea",
  "barat",
  "seafood",
  "kopi_minuman",
  "manis_roti",
  "lainnya",
] as const;

export type CuisineSlot = (typeof CUISINE_SLOTS)[number];

/**
 * Nilai kolom `category` yang ditulis untuk tiap slot oleh kurasi otomatis.
 *
 * Bukan nama slot mentah: kolom ini juga dibaca manusia di halaman hasil dan
 * peta, jadi isinya harus tetap enak dibaca. Syarat kerasnya cuma satu —
 * `toCuisineSlot(CUISINE_LABELS[slot]) === slot` — dan itu dikunci oleh tes,
 * karena label yang jatuh ke slot lain akan diam-diam merusak fitur model.
 *
 * `lainnya` tidak punya label: kurasi otomatis tidak pernah menulis "tidak
 * tahu" ke database. Yang tidak yakin dibiarkan seperti semula.
 */
export const CUISINE_LABELS: Record<Exclude<CuisineSlot, "lainnya">, string> = {
  ayam: "Ayam",
  mie: "Mie & Bakso",
  nusantara: "Nusantara",
  sunda: "Sunda",
  padang: "Padang",
  chinese: "Chinese",
  jepang_korea: "Jepang & Korea",
  barat: "Western",
  seafood: "Seafood",
  kopi_minuman: "Kopi & Minuman",
  manis_roti: "Roti & Dessert",
};

/**
 * Kata kunci per slot, dicocokkan pada nama kategori yang sudah dihuruf-kecilkan.
 *
 * Dicocokkan berurutan, jadi yang lebih spesifik harus lebih dulu: "Chicken
 * restaurant" harus jatuh ke `ayam`, bukan tertangkap "restaurant" dan jatuh
 * ke `lainnya`.
 */
const SLOT_KEYWORDS: Array<[CuisineSlot, string[]]> = [
  ["ayam", ["ayam", "chicken", "geprek", "penyet"]],
  ["mie", ["mie", "mi ayam", "noodle", "ramen", "bakmi", "bakso"]],
  ["sunda", ["sunda", "sundanese"]],
  ["padang", ["padang", "minang"]],
  ["chinese", ["chinese", "dim sum", "dimsum", "dumpling", "hokben", "kwetiau"]],
  ["jepang_korea", ["japanese", "jepang", "sushi", "korean", "korea"]],
  [
    "barat",
    [
      "western", "barat", "pizza", "burger", "american", "italian",
      "steak", "sandwich", "fast food", "cepat saji", "pasta",
    ],
  ],
  ["seafood", ["seafood", "fish", "ikan", "seafood restaurant"]],
  [
    "kopi_minuman",
    ["coffee", "kopi", "cafe", "kafe", "kopitiam", "juice", "bubble tea", "minuman"],
  ],
  [
    "manis_roti",
    ["bakery", "roti", "cake", "kue", "dessert", "manis", "ice cream", "es krim", "martabak"],
  ],
  // Paling akhir: istilah umum Indonesia yang tidak menunjuk masakan tertentu.
  ["nusantara", ["indonesian", "nusantara", "javanese", "jawa", "warteg", "regional", "buffet", "prasmanan"]],
];

/**
 * Memetakan nilai kolom `category` ke satu slot.
 *
 * Kategori yang tidak dikenal — termasuk `null` dan "Restaurant" polos —
 * jatuh ke `lainnya`.
 *
 * Catatan soal data: "Restaurant" adalah nilai paling umum di data seed, dan
 * ia tidak membedakan apa pun. Selama itu belum dikurasi, blok fitur masakan
 * praktis tidak membawa informasi untuk sebagian besar tempat. Itu masalah
 * kualitas data (Fase B), bukan masalah model.
 */
export function toCuisineSlot(category: string | null | undefined): CuisineSlot {
  if (typeof category !== "string") return "lainnya";

  const normalized = category.toLowerCase().trim();
  if (normalized === "") return "lainnya";

  for (const [slot, keywords] of SLOT_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      return slot;
    }
  }

  return "lainnya";
}

/**
 * Tingkat harga 1–4 dari harga rupiah.
 *
 * Roadmap memakai `price_level/4`, tapi database menyimpan rupiah. Ambangnya
 * dipilih dari rentang yang benar-benar dipakai mahasiswa di Jatinangor, bukan
 * dari kuartil global yang akan bergeser setiap kali katalognya bertambah.
 *
 * Mengembalikan `null` kalau harganya belum dikurasi — dan `null` harus tetap
 * `null` sampai ke fitur, bukan ditebak jadi tingkat 2.
 */
export function toPriceLevel(priceTier: number | null | undefined): number | null {
  if (typeof priceTier !== "number" || !Number.isFinite(priceTier)) return null;
  if (priceTier <= 0) return null;

  if (priceTier <= 10_000) return 1;
  if (priceTier <= 20_000) return 2;
  if (priceTier <= 35_000) return 3;
  return 4;
}

/**
 * Apakah jam ini termasuk jam makan.
 *
 * Sarapan 6–9, makan siang 11–14, makan malam 17–20. Di luar itu orang tetap
 * lapar, tapi pola pilihannya berbeda — dan itulah yang ingin ditangkap fitur
 * ini.
 */
export function isMealtime(hourLocal: number): boolean {
  return (
    (hourLocal >= 6 && hourLocal < 9) ||
    (hourLocal >= 11 && hourLocal < 14) ||
    (hourLocal >= 17 && hourLocal < 20)
  );
}
