/**
 * Lingkungan simulasi untuk membandingkan kebijakan sebelum ada data nyata.
 *
 * Simulator ini memakai `buildFeatureVector` yang asli, dengan pencacah
 * berjalan yang disusun persis seperti di `training.ts`. Itu disengaja:
 * simulator yang memakai fitur karangan sendiri hanya menguji simulatornya,
 * bukan sistem yang akan dipakai.
 *
 * BATASAN YANG HARUS DIBACA SEBELUM MEMPERCAYAI ANGKANYA:
 *
 *   - Pengguna sintetis di sini **linear dan stasioner**. Preferensinya tidak
 *     berubah, tidak bosan, dan tidak dipengaruhi teman di grup chat. Manusia
 *     tidak begitu.
 *   - `P(accept) = sigmoid(θ*ᵀx)` mengasumsikan reward-nya benar-benar fungsi
 *     dari fitur yang kita punya. Kalau yang menentukan sebenarnya sesuatu
 *     yang tidak ada di vektor — misalnya warungnya sedang ramai — model tidak
 *     akan pernah menemukannya, dan simulasi ini tidak akan menunjukkannya.
 *   - Hasil di sini **bukan bukti** sistemnya bekerja pada orang sungguhan.
 *     Ia hanya bukti bahwa modelnya belajar kalau dunianya seperti yang
 *     diasumsikan.
 *
 * Satu paragraf keterbatasan yang jujur lebih berharga daripada grafik yang
 * mengklaim terlalu banyak.
 */

import {
  ablateBlock,
  buildFeatureVector,
  FEATURE_DIM,
  type PriorStats,
} from "@/lib/ml/features";
import { createRng, dot, sigmoid, standardNormal, type Vector } from "@/lib/ml/linalg";
import { CUISINE_SLOTS } from "@/lib/ml/taxonomy";
import type { Policy } from "@/lib/ml/bandit";

export interface SimRestaurant {
  id: string;
  category: string;
  priceTier: number;
  /** Jarak dasar dari pusat kampus, km. */
  baseDistanceKm: number;
}

export interface SimulationConfig {
  users: number;
  restaurants: number;
  rounds: number;
  /** Berapa kandidat yang masuk radius tiap ronde. */
  candidatesPerRound: number;
  seed: number;
  /**
   * Nama blok fitur yang dinolkan untuk seluruh kandidat.
   *
   * Untuk ablasi: buang satu blok, ukur penurunannya. Ini yang membedakan
   * "aku pakai library" dari "aku paham modelnya" — dan ia juga memberi tahu
   * blok mana yang sebenarnya belum membawa informasi karena datanya kurang.
   */
  ablate?: string;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  users: 40,
  restaurants: 60,
  rounds: 3000,
  candidatesPerRound: 15,
  seed: 20260804,
};

export interface PolicyResult {
  name: string;
  /** Rata-rata peluang terima dari kandidat yang dipilih. */
  acceptRate: number;
  /** Σ (peluang terbaik − peluang terpilih). Grafik utama. */
  cumulativeRegret: number;
  /** Accept rate bergerak per 100 ronde; menunjukkan kurva belajar. */
  learningCurve: number[];
  /** Porsi katalog yang pernah ditayangkan. */
  coverage: number;
  /**
   * Rata-rata peluang terima kandidat TERBAIK tiap ronde — batas atas yang
   * hanya bisa dicapai kalau θ* diketahui.
   *
   * Nilainya sedikit berbeda antar kebijakan, dan itu bukan bug: fitur
   * popularitas dan afinitas bergantung pada apa yang PERNAH ditayangkan, jadi
   * kebijakan yang memilih berbeda perlahan menggeser lingkungannya sendiri.
   * Persis seperti sistem sungguhan.
   */
  oracleAcceptRate: number;
}

/**
 * Membangkitkan katalog restoran.
 *
 * Distribusinya dipilih menyerupai data Jatinangor yang ada: sebagian besar
 * murah, sebagian besar dekat, dan **sepertiga tanpa kategori yang berarti** —
 * itu kondisi nyata data seed, di mana "Restaurant" polos adalah nilai paling
 * umum. Simulasi dengan katalog yang lebih rapi dari kenyataan akan
 * melebih-lebihkan manfaat modelnya.
 */
export function generateRestaurants(
  count: number,
  rng: () => number,
): SimRestaurant[] {
  const slots = CUISINE_SLOTS.filter((slot) => slot !== "lainnya");

  return Array.from({ length: count }, (_, index) => {
    const uncategorised = rng() < 0.33;
    return {
      id: `resto-${index}`,
      category: uncategorised
        ? "Restaurant"
        : slots[Math.floor(rng() * slots.length)],
      // Condong ke murah: kuadrat menarik sebarannya ke bawah.
      priceTier: Math.round(8000 + rng() * rng() * 42000),
      baseDistanceKm: 0.1 + rng() * rng() * 4,
    };
  });
}

/**
 * Preferensi laten tiap pengguna sintetis.
 *
 * Bentuknya `θ*_u = θ_bersama + deviasi kecil`, dan itu keputusan yang
 * menentukan seluruh hasil simulasi.
 *
 * Alasannya struktural: model ini belajar SATU θ yang dibagi ke semua
 * pengguna, dan konteks yang dilihatnya hanya punya dua dimensi afinitas
 * pengguna. Kalau tiap pengguna diberi θ* acak yang sepenuhnya bebas, tidak
 * ada θ tunggal yang bisa mewakili mereka — bandit kontekstual mana pun akan
 * kalah dari baseline "ambil yang terdekat", dan yang terukur bukan mutu
 * modelnya melainkan ketidakcocokan antara model dan lingkungan karangan kita.
 *
 * Mahasiswa di satu kawasan memang berbagi sebagian besar seleranya — murah
 * dan dekat — dengan variasi pribadi di atasnya. Deviasi itulah yang menjadi
 * tugas fitur afinitas pengguna.
 */
export function generateUserThetas(
  count: number,
  rng: () => number,
): Vector[] {
  const shared = Array.from({ length: FEATURE_DIM }, () => standardNormal(rng) * 0.7);

  // Indeks 0 dan 1 adalah fitur jarak; keduanya naik saat makin dekat.
  shared[0] = Math.abs(shared[0]) + 1.2;
  shared[1] = Math.abs(shared[1]) + 1.2;

  // Indeks 25 adalah bias; digeser supaya tidak semua orang bilang ya.
  shared[25] = -1.6;

  return Array.from({ length: count }, () =>
    shared.map((value, index) => {
      // Bias dibiarkan hampir seragam supaya accept rate dasarnya tidak
      // berbeda jauh antar pengguna.
      const spread = index === 25 ? 0.15 : 0.35;
      return value + standardNormal(rng) * spread;
    }),
  );
}

interface Counter {
  impressions: number;
  accepts: number;
}

const EMPTY: PriorStats = { impressions: 0, accepts: 0 };

/**
 * Menjalankan satu kebijakan di lingkungan yang benihnya tetap.
 *
 * Setiap kebijakan menerima urutan pengguna, kandidat, dan konteks yang sama
 * persis, karena semuanya diturunkan dari benih yang sama. Tanpa itu,
 * perbandingannya sebagian mengukur keberuntungan.
 */
export function runPolicy(
  policy: Policy,
  config: SimulationConfig,
  restaurants: SimRestaurant[],
  userThetas: Vector[],
): PolicyResult {
  const rng = createRng(config.seed);

  const userCategory = new Map<string, Counter>();
  const userPrice = new Map<string, Counter>();
  const restaurantStats = new Map<string, Counter>();
  const acceptedPriceSum = new Map<number, number>();
  const acceptedPriceCount = new Map<number, number>();

  let globalImpressions = 0;
  let globalAccepts = 0;

  let cumulativeRegret = 0;
  let totalAcceptProbability = 0;
  let totalBestProbability = 0;
  const shown = new Set<string>();
  const learningCurve: number[] = [];
  let bucketSum = 0;

  const read = (map: Map<string, Counter>, key: string): PriorStats =>
    map.get(key) ?? EMPTY;

  const bump = (map: Map<string, Counter>, key: string, accepted: boolean) => {
    const entry = map.get(key) ?? { impressions: 0, accepts: 0 };
    entry.impressions += 1;
    if (accepted) entry.accepts += 1;
    map.set(key, entry);
  };

  for (let round = 0; round < config.rounds; round += 1) {
    const userIndex = Math.floor(rng() * config.users);
    const theta = userThetas[userIndex];

    const hourLocal = Math.floor(rng() * 24);
    const dayOfWeek = Math.floor(rng() * 7);
    const isRaining = rng() < 0.15;

    const globalAcceptRate =
      globalImpressions > 0 ? globalAccepts / globalImpressions : 0;

    const acceptedCount = acceptedPriceCount.get(userIndex) ?? 0;
    const userMeanAcceptedPrice =
      acceptedCount > 0
        ? (acceptedPriceSum.get(userIndex) ?? 0) / acceptedCount
        : null;

    // Kandidat ronde ini: sampel acak dari katalog, seperti hasil filter radius.
    const candidates: SimRestaurant[] = [];
    const vectors: Vector[] = [];
    const policyVectors: Vector[] = [];
    const picked = new Set<number>();

    while (candidates.length < config.candidatesPerRound) {
      const index = Math.floor(rng() * restaurants.length);
      if (picked.has(index)) continue;
      picked.add(index);

      const restaurant = restaurants[index];
      // Jarak bergoyang sedikit tiap ronde: pengguna tidak selalu berdiri di
      // titik yang sama.
      const distanceKm = Math.max(0.05, restaurant.baseDistanceKm * (0.7 + rng() * 0.6));

      candidates.push(restaurant);
      const vector = buildFeatureVector({
          distanceKm,
          priceTier: restaurant.priceTier,
          category: restaurant.category,
          hourLocal,
          dayOfWeek,
          isRaining,
          userCategoryStats: read(userCategory, `${userIndex}|${restaurant.category}`),
          userPriceStats: read(userPrice, `${userIndex}|${restaurant.priceTier}`),
          restaurantStats: read(restaurantStats, restaurant.id),
        userMeanAcceptedPrice,
        globalAcceptRate,
      });

      // Yang dibutakan HANYA kebijakannya; hadiahnya tetap dihitung dari
      // fitur penuh. Kalau lingkungannya ikut dibutakan, oracle-nya ikut
      // berubah dan angka regret dari dua ablasi tidak lagi sebanding —
      // membuang blok bahkan bisa terlihat "menguntungkan".
      vectors.push(vector);
      policyVectors.push(config.ablate ? ablateBlock(vector, config.ablate) : vector);
    }

    const probabilities = vectors.map((x) => sigmoid(dot(theta, x)));
    const bestProbability = Math.max(...probabilities);

    const chosen = policy.select(policyVectors);
    const chosenProbability = probabilities[chosen];
    const accepted = rng() < chosenProbability;

    // Kebijakan belajar dari apa yang ia LIHAT, bukan dari fitur penuh yang
    // disembunyikan darinya.
    policy.update(policyVectors[chosen], accepted ? 1 : 0);

    cumulativeRegret += bestProbability - chosenProbability;
    totalAcceptProbability += chosenProbability;
    totalBestProbability += bestProbability;
    shown.add(candidates[chosen].id);
    bucketSum += chosenProbability;

    if ((round + 1) % 100 === 0) {
      learningCurve.push(bucketSum / 100);
      bucketSum = 0;
    }

    const restaurant = candidates[chosen];
    bump(userCategory, `${userIndex}|${restaurant.category}`, accepted);
    bump(userPrice, `${userIndex}|${restaurant.priceTier}`, accepted);
    bump(restaurantStats, restaurant.id, accepted);
    globalImpressions += 1;
    if (accepted) globalAccepts += 1;

    if (accepted) {
      acceptedPriceSum.set(
        userIndex,
        (acceptedPriceSum.get(userIndex) ?? 0) + restaurant.priceTier,
      );
      acceptedPriceCount.set(userIndex, acceptedCount + 1);
    }
  }

  return {
    name: policy.name,
    acceptRate: totalAcceptProbability / config.rounds,
    cumulativeRegret,
    learningCurve,
    coverage: shown.size / restaurants.length,
    oracleAcceptRate: totalBestProbability / config.rounds,
  };
}

/**
 * Menjalankan seluruh kebijakan di lingkungan yang identik.
 *
 * Urutan pengguna, kandidat, dan konteksnya sama persis untuk semua kebijakan
 * karena diturunkan dari benih yang sama, dan tiap kebijakan memakai
 * pembangkit acaknya sendiri. Tanpa itu, sebagian dari perbandingannya
 * mengukur keberuntungan.
 */
export function runAll(
  policies: Policy[],
  config: SimulationConfig = DEFAULT_CONFIG,
): { results: PolicyResult[]; oracleAcceptRate: number } {
  const setupRng = createRng(config.seed ^ 0x5eed);
  const restaurants = generateRestaurants(config.restaurants, setupRng);
  const userThetas = generateUserThetas(config.users, setupRng);

  const results = policies.map((policy) =>
    runPolicy(policy, config, restaurants, userThetas),
  );

  // Dirata-ratakan, bukan diambil dari yang pertama: tiap kebijakan menggeser
  // lingkungannya sendiri lewat fitur popularitas, jadi batas atasnya tidak
  // persis sama.
  const oracleAcceptRate =
    results.length > 0
      ? results.reduce((sum, result) => sum + result.oracleAcceptRate, 0) /
        results.length
      : 0;

  return { results, oracleAcceptRate };
}
