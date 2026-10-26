/**
 * Fungsi fitur: (user, restaurant, context) → vektor R^26.
 *
 * Ini jantung sistem rekomendasi. Semua fase berikutnya memanggilnya —
 * simulator, pelatihan, dan inferensi di route handler — jadi ia harus
 * **murni**: tidak menyentuh jaringan, tidak membaca jam, tidak membaca
 * database. Semua yang berubah masuk lewat parameter.
 *
 * Kemurnian itu bukan soal kerapian. Fungsi yang diam-diam membaca `Date.now()`
 * akan menghasilkan vektor berbeda saat pelatihan dan saat penyajian untuk
 * peristiwa yang sama, dan perbedaan itu tidak akan muncul di test mana pun
 * sampai modelnya sudah dipakai orang.
 *
 * ATURAN YANG TIDAK BOLEH DILANGGAR: statistik historis di `userAffinity` dan
 * `restaurantStats` harus dihitung HANYA dari peristiwa sebelum `shownAt`
 * baris yang sedang dihitung. Lihat view `spin_training_rows`. Kalau dihitung
 * dari seluruh dataset, masa depan bocor ke masa lalu dan hasil evaluasinya
 * akan terlihat spektakuler sekaligus tidak berarti apa-apa.
 */

import {
  CUISINE_SLOTS,
  isMealtime,
  toCuisineSlot,
  toPriceLevel,
  type CuisineSlot,
} from "@/lib/ml/taxonomy";

export const FEATURE_DIM = 26;

/**
 * Blok fitur beserta rentang indeksnya.
 *
 * Dipakai untuk ablasi di Fase 2: buang satu blok, ukur penurunannya. Itu yang
 * membedakan "aku pakai library" dari "aku paham modelnya".
 */
export const FEATURE_BLOCKS = [
  { name: "jarak", start: 0, end: 2 },
  { name: "harga", start: 2, end: 4 },
  { name: "masakan", start: 4, end: 16 },
  { name: "waktu", start: 16, end: 20 },
  { name: "cuaca", start: 20, end: 21 },
  { name: "afinitas_user", start: 21, end: 23 },
  { name: "popularitas", start: 23, end: 25 },
  { name: "bias", start: 25, end: 26 },
] as const;

export const FEATURE_NAMES: readonly string[] = [
  "jarak_neg_log",
  "jarak_inverse",
  "harga_level",
  "harga_selisih_dari_kebiasaan",
  ...CUISINE_SLOTS.map((slot) => `masakan_${slot}`),
  "waktu_sin",
  "waktu_cos",
  "waktu_akhir_pekan",
  "waktu_jam_makan",
  "cuaca_hujan",
  "afinitas_kategori",
  "afinitas_tingkat_harga",
  "populer_accept_rate",
  "populer_jumlah_tayang",
  "bias",
];

/**
 * Statistik yang dihitung dari peristiwa SEBELUM penayangan ini.
 *
 * Nilai `impressions` ikut dibawa, bukan hanya rasionya, supaya penghalusan
 * bisa dilakukan di sini. Rasio 1/1 dan 40/50 bukan bukti yang sama kuatnya,
 * dan model linear tidak punya cara mengetahuinya kalau yang diberikan cuma
 * angka 1.0 dan 0.8.
 */
export interface PriorStats {
  impressions: number;
  accepts: number;
}

export interface FeatureInput {
  /** Jarak ke restoran saat ditayangkan, dalam kilometer. */
  distanceKm: number;

  /** Harga rupiah restoran. `null` kalau belum dikurasi. */
  priceTier: number | null;

  /** Isi kolom `category` apa adanya; dinormalkan di dalam. */
  category: string | null;

  /** Jam lokal 0–23 saat penayangan. */
  hourLocal: number;

  /** 0 = Minggu, 6 = Sabtu. */
  dayOfWeek: number;

  /** `null` berarti tidak tahu, BUKAN "tidak hujan". */
  isRaining: boolean | null;

  /** Riwayat user untuk kategori restoran ini, sebelum penayangan ini. */
  userCategoryStats: PriorStats;

  /** Riwayat user untuk tingkat harga ini, sebelum penayangan ini. */
  userPriceStats: PriorStats;

  /** Riwayat restoran ini di seluruh pengguna, sebelum penayangan ini. */
  restaurantStats: PriorStats;

  /**
   * Rata-rata harga yang pernah diterima user, dalam rupiah. `null` kalau
   * belum pernah menerima apa pun.
   */
  userMeanAcceptedPrice: number | null;

  /**
   * Accept rate global sebagai titik jangkar penghalusan. Dihitung dari
   * seluruh data sebelum penayangan ini juga.
   */
  globalAcceptRate: number;
}

/**
 * Kekuatan penghalusan: berapa banyak "penayangan bayangan" pada rata-rata
 * global yang ditambahkan ke tiap hitungan.
 *
 * Dengan α=5, satu penayangan yang diterima menggeser estimasi sedikit saja
 * dari rata-rata, sementara lima puluh penayangan hampir sepenuhnya menentukan.
 * Tanpa ini, restoran yang baru sekali tayang dan kebetulan diterima akan
 * terlihat sempurna dan langsung mendominasi rekomendasi.
 */
const SMOOTHING_ALPHA = 5;

/** Skala untuk fitur jumlah tayang; 1000 tayang memberi nilai ≈ 1. */
const IMPRESSION_SCALE = Math.log1p(1000);

/**
 * Skala jarak, dalam km. Dipilih dari batas radius terbesar yang diterima
 * /api/spin (50 km), bukan dari batas slider (5 km), supaya fiturnya tetap
 * terurut untuk seluruh masukan yang sah — bukan hanya yang biasa terjadi.
 *
 * Resolusi di jarak dekat ditangani fitur `1/(1+km)` di sebelahnya, dan di
 * situlah keputusan mahasiswa sebenarnya berubah.
 */
const DISTANCE_SCALE = Math.log1p(50);

/** Skala selisih harga, dalam rupiah. */
const PRICE_DIFF_SCALE = 20_000;

/**
 * Estimasi accept rate yang dihaluskan ke arah rata-rata global, lalu
 * dipusatkan pada nol.
 *
 * Dipusatkan supaya "belum ada riwayat" berarti nol — tidak memberi dorongan
 * ke arah mana pun. Kalau tidak dipusatkan, restoran tanpa riwayat akan masuk
 * dengan nilai konstan yang model harus belajar mengabaikannya, dan itu
 * pemborosan satu dimensi.
 */
function centeredRate(stats: PriorStats, prior: number): number {
  const impressions = Math.max(0, stats.impressions);
  const accepts = Math.min(Math.max(0, stats.accepts), impressions);

  const smoothed =
    (accepts + SMOOTHING_ALPHA * prior) / (impressions + SMOOTHING_ALPHA);

  return smoothed - prior;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Membangun vektor fitur untuk satu pasangan (penayangan, restoran).
 *
 * Nilainya dijaga kira-kira di rentang [-1, 1] supaya prior ridge `λI` masuk
 * akal untuk semua dimensi sekaligus. Satu dimensi yang skalanya seratus kali
 * lebih besar akan menelan seluruh regularisasi dimensi lain.
 */
export function buildFeatureVector(input: FeatureInput): number[] {
  const x = new Array<number>(FEATURE_DIM).fill(0);

  // --- Jarak (0..1) ---------------------------------------------------------
  // Dua bentuk sekaligus karena keduanya menurun dengan cara berbeda: yang
  // pertama menghukum jarak jauh secara halus, yang kedua jatuh cepat di
  // ratusan meter pertama — dan di situlah keputusan mahasiswa berubah.
  const km = Number.isFinite(input.distanceKm) ? Math.max(0, input.distanceKm) : 0;
  // Dijepit supaya jarak di luar dugaan tidak menggeser skala seluruh vektor.
  x[0] = clamp(-Math.log1p(km) / DISTANCE_SCALE, -1, 0);
  x[1] = 1 / (1 + km);

  // --- Harga (2..3) ---------------------------------------------------------
  const priceLevel = toPriceLevel(input.priceTier);
  // Harga yang belum dikurasi tetap 0: tidak tahu, bukan "murah".
  x[2] = priceLevel === null ? 0 : priceLevel / 4;

  if (
    priceLevel !== null &&
    input.userMeanAcceptedPrice !== null &&
    Number.isFinite(input.userMeanAcceptedPrice) &&
    input.priceTier !== null
  ) {
    x[3] = clamp(
      (input.priceTier - input.userMeanAcceptedPrice) / PRICE_DIFF_SCALE,
      -1,
      1,
    );
  }

  // --- Masakan (4..15) ------------------------------------------------------
  const slot: CuisineSlot = toCuisineSlot(input.category);
  x[4 + CUISINE_SLOTS.indexOf(slot)] = 1;

  // --- Waktu (16..19) -------------------------------------------------------
  // Melingkar, supaya jam 23 dan jam 0 berdekatan di ruang fitur. Kalau jam
  // dipakai apa adanya sebagai angka 0–23, model akan menganggap tengah malam
  // sejauh mungkin dari jam 11 malam.
  const hour = Number.isFinite(input.hourLocal) ? input.hourLocal : 0;
  x[16] = Math.sin((2 * Math.PI * hour) / 24);
  x[17] = Math.cos((2 * Math.PI * hour) / 24);
  x[18] = input.dayOfWeek === 0 || input.dayOfWeek === 6 ? 1 : 0;
  x[19] = isMealtime(hour) ? 1 : 0;

  // --- Cuaca (20) -----------------------------------------------------------
  // Tiga keadaan dalam satu dimensi: +1 hujan, -1 tidak hujan, 0 tidak tahu.
  // Memakai 0/1 akan membuat "tidak tahu" tidak bisa dibedakan dari "tidak
  // hujan", dan model belajar dari kebohongan itu.
  x[20] = input.isRaining === null ? 0 : input.isRaining ? 1 : -1;

  // --- Afinitas user (21..22) ----------------------------------------------
  const prior = clamp(input.globalAcceptRate, 0, 1);
  x[21] = centeredRate(input.userCategoryStats, prior);
  x[22] = centeredRate(input.userPriceStats, prior);

  // --- Popularitas (23..24) -------------------------------------------------
  x[23] = centeredRate(input.restaurantStats, prior);
  x[24] = clamp(
    Math.log1p(Math.max(0, input.restaurantStats.impressions)) / IMPRESSION_SCALE,
    0,
    1,
  );

  // --- Bias (25) ------------------------------------------------------------
  x[25] = 1;

  return x;
}

/**
 * Menyalin vektor dengan satu blok fitur dinolkan.
 *
 * Alat untuk ablasi di Fase 2. Dinolkan, bukan dibuang, supaya panjang
 * vektornya tetap dan hasilnya bisa dibandingkan langsung dengan model penuh.
 */
export function ablateBlock(x: number[], blockName: string): number[] {
  const block = FEATURE_BLOCKS.find((entry) => entry.name === blockName);
  if (!block) {
    throw new Error(
      `ablateBlock: blok "${blockName}" tidak dikenal. Pilihan: ` +
        FEATURE_BLOCKS.map((entry) => entry.name).join(", "),
    );
  }

  const copy = [...x];
  for (let index = block.start; index < block.end; index += 1) {
    copy[index] = 0;
  }
  return copy;
}
