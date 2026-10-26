/**
 * Menyusun data latih dari log spin, tanpa kebocoran masa depan.
 *
 * Kenapa di TypeScript dan bukan SQL window function: fitur masakan bergantung
 * pada `toCuisineSlot`, yang menyatukan dua kosakata kategori. Kalau pemetaan
 * itu ditulis ulang di SQL, ia akan berbeda dari versi TypeScript cepat atau
 * lambat — dan bedanya berarti vektor saat pelatihan tidak sama dengan vektor
 * saat penyajian untuk peristiwa yang sama. Bug seperti itu tidak muncul di
 * test mana pun sampai modelnya sudah dipakai orang.
 *
 * Satu sumber, satu perilaku.
 *
 * KEBOCORAN DICEGAH SECARA STRUKTURAL, bukan lewat filter yang bisa lupa
 * ditulis: baris diproses berurutan menurut `shown_at`, fitur dihitung dari
 * pencacah yang isinya HANYA baris-baris sebelumnya, dan pencacah baru
 * diperbarui SESUDAH fiturnya dibuat. Tidak ada jalan bagi hasil sebuah baris
 * untuk memengaruhi fiturnya sendiri.
 */

import {
  buildFeatureVector,
  type FeatureInput,
  type PriorStats,
} from "@/lib/ml/features";
import { toCuisineSlot, toPriceLevel } from "@/lib/ml/taxonomy";

/** Satu baris log, dari kueri ekspor di `scripts/lib/spin-export.ts`. */
export interface RawSpinRow {
  id: string;
  user_id: string;
  restaurant_id: string;
  /** ISO 8601. Menentukan urutan pemrosesan. */
  shown_at: string;
  category: string | null;
  price_tier: number | null;
  distance_km: number;
  hour_local: number;
  day_of_week: number;
  is_raining: boolean | null;
  /**
   * Label yang sudah selesai. `null` berarti jendela responsnya belum habis —
   * baris seperti itu dibuang, tidak dihitung sebagai penolakan.
   */
  effective_action: string | null;
  /** Peluang kebijakan lama memilih baris ini. Dibawa untuk evaluasi Fase 4. */
  policy_score: number | null;
  policy: string;
  /**
   * Seluruh kandidat saat penayangan, dan jaraknya dalam meter. Hanya ada di
   * baris setelah migrasi `kandidat_spin`; dibutuhkan evaluasi off-policy,
   * tidak dibutuhkan pelatihan.
   */
  candidate_ids?: string[] | null;
  candidate_distances_m?: number[] | null;
}

export interface TrainingExample {
  eventId: string;
  x: number[];
  /** 1 kalau diterima, 0 kalau tidak. */
  reward: number;
  shownAt: string;
  restaurantId: string;
  userId: string;
  /** Dibawa apa adanya untuk inverse propensity scoring di Fase 4. */
  policyScore: number | null;
  policy: string;
}

interface Counter {
  impressions: number;
  accepts: number;
}

const EMPTY: PriorStats = { impressions: 0, accepts: 0 };

function bump(map: Map<string, Counter>, key: string, accepted: boolean): void {
  const entry = map.get(key) ?? { impressions: 0, accepts: 0 };
  entry.impressions += 1;
  if (accepted) entry.accepts += 1;
  map.set(key, entry);
}

function read(map: Map<string, Counter>, key: string): PriorStats {
  return map.get(key) ?? EMPTY;
}

/** Konteks satu pasangan (penayangan, restoran) yang dibutuhkan fungsi fitur. */
export interface ImpressionContext {
  userId: string;
  restaurantId: string;
  category: string | null;
  priceTier: number | null;
  distanceKm: number;
  hourLocal: number;
  dayOfWeek: number;
  isRaining: boolean | null;
}

/**
 * Statistik restoran dan global yang dibekukan saat pelatihan.
 *
 * Dipakai saat penyajian: route handler hanya bisa membaca riwayat pengguna
 * yang sedang meminta (RLS), jadi popularitas restoran tidak bisa dihitung
 * langsung di sana. Nilainya ketinggalan sejak pelatihan terakhir — itu
 * harga yang sengaja dibayar demi tidak memakai service_role.
 */
export interface PriorSnapshot {
  globalImpressions: number;
  globalAccepts: number;
  restaurants: Record<string, PriorStats>;
}

/**
 * Pencacah riwayat yang dipakai bersama oleh pelatihan, evaluasi, dan
 * penyajian.
 *
 * Satu kelas, supaya ketiganya menghitung fitur dengan cara yang sama persis.
 * Urutan pemakaiannya yang menjamin tidak ada kebocoran: `featureInput` untuk
 * semua kandidat sebuah penayangan dulu, baru `observe` hasilnya.
 */
export class PriorTracker {
  private readonly userCategory = new Map<string, Counter>();
  private readonly userPrice = new Map<string, Counter>();
  private readonly restaurant = new Map<string, Counter>();
  private readonly acceptedPriceSum = new Map<string, number>();
  private readonly acceptedPriceCount = new Map<string, number>();
  private globalImpressions = 0;
  private globalAccepts = 0;

  /**
   * @param snapshot - Statistik restoran dan global sebagai titik awal.
   *   Dipakai saat penyajian; pelatihan mulai dari nol.
   */
  constructor(snapshot?: PriorSnapshot) {
    if (snapshot) {
      this.globalImpressions = snapshot.globalImpressions;
      this.globalAccepts = snapshot.globalAccepts;
      for (const [id, stats] of Object.entries(snapshot.restaurants)) {
        this.restaurant.set(id, { ...stats });
      }
    }
  }

  private keys(ctx: ImpressionContext): { categoryKey: string; priceKey: string } {
    const slot = toCuisineSlot(ctx.category);
    const priceLevel = toPriceLevel(ctx.priceTier);
    return {
      categoryKey: `${ctx.userId}|${slot}`,
      priceKey: `${ctx.userId}|${priceLevel ?? "unknown"}`,
    };
  }

  /** Masukan fungsi fitur, dari riwayat SEBELUM penayangan ini saja. */
  featureInput(ctx: ImpressionContext): FeatureInput {
    const { categoryKey, priceKey } = this.keys(ctx);

    // Tanpa riwayat sama sekali, rata-rata global belum terdefinisi. Nol
    // adalah titik jangkar yang jujur: belum ada bukti apa pun.
    const globalAcceptRate =
      this.globalImpressions > 0 ? this.globalAccepts / this.globalImpressions : 0;

    const count = this.acceptedPriceCount.get(ctx.userId) ?? 0;
    const userMeanAcceptedPrice =
      count > 0 ? (this.acceptedPriceSum.get(ctx.userId) ?? 0) / count : null;

    return {
      distanceKm: ctx.distanceKm,
      priceTier: ctx.priceTier,
      category: ctx.category,
      hourLocal: ctx.hourLocal,
      dayOfWeek: ctx.dayOfWeek,
      isRaining: ctx.isRaining,
      userCategoryStats: read(this.userCategory, categoryKey),
      userPriceStats: read(this.userPrice, priceKey),
      restaurantStats: read(this.restaurant, ctx.restaurantId),
      userMeanAcceptedPrice,
      globalAcceptRate,
    };
  }

  features(ctx: ImpressionContext): number[] {
    return buildFeatureVector(this.featureInput(ctx));
  }

  /**
   * Mencatat hasil penayangan.
   *
   * @param countGlobally - `false` untuk riwayat pengguna yang diputar ulang di
   *   atas snapshot saat penyajian: penayangan itu sudah termasuk di angka
   *   global dan restoran snapshot, jadi menghitungnya lagi berarti ganda.
   */
  observe(ctx: ImpressionContext, accepted: boolean, countGlobally = true): void {
    const { categoryKey, priceKey } = this.keys(ctx);
    bump(this.userCategory, categoryKey, accepted);
    bump(this.userPrice, priceKey, accepted);

    if (countGlobally) {
      bump(this.restaurant, ctx.restaurantId, accepted);
      this.globalImpressions += 1;
      if (accepted) this.globalAccepts += 1;
    }

    if (accepted && typeof ctx.priceTier === "number" && ctx.priceTier > 0) {
      const count = this.acceptedPriceCount.get(ctx.userId) ?? 0;
      this.acceptedPriceSum.set(
        ctx.userId,
        (this.acceptedPriceSum.get(ctx.userId) ?? 0) + ctx.priceTier,
      );
      this.acceptedPriceCount.set(ctx.userId, count + 1);
    }
  }

  snapshot(): PriorSnapshot {
    return {
      globalImpressions: this.globalImpressions,
      globalAccepts: this.globalAccepts,
      restaurants: Object.fromEntries(
        [...this.restaurant.entries()].map(([id, stats]) => [id, { ...stats }]),
      ),
    };
  }
}

/** Urutan waktu, dengan id sebagai pemecah seri supaya hasilnya deterministik. */
export function chronological<T extends { id: string; shown_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byTime = Date.parse(a.shown_at) - Date.parse(b.shown_at);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}

export function rowContext(row: RawSpinRow): ImpressionContext {
  return {
    userId: row.user_id,
    restaurantId: row.restaurant_id,
    category: row.category,
    priceTier: row.price_tier,
    distanceKm: row.distance_km,
    hourLocal: row.hour_local,
    dayOfWeek: row.day_of_week,
    isRaining: row.is_raining,
  };
}

/**
 * Mengubah log mentah jadi contoh latih.
 *
 * @param rows - Baris log; urutannya tidak perlu rapi, akan diurutkan di sini
 * @param tracker - Pencacah yang dipakai; diisi selama pemrosesan, sehingga
 *   setelah fungsi ini selesai `tracker.snapshot()` adalah keadaan akhirnya
 * @returns Contoh latih menurut urutan waktu penayangan
 */
export function buildTrainingSet(
  rows: RawSpinRow[],
  tracker: PriorTracker = new PriorTracker(),
): TrainingExample[] {
  const examples: TrainingExample[] = [];

  for (const row of chronological(rows)) {
    // Baris yang belum punya label bukan penolakan — ia belum menjawab apa
    // pun. Dibuang, dan tidak boleh ikut memperbarui pencacah.
    if (row.effective_action === null || row.effective_action === undefined) {
      continue;
    }

    const accepted = row.effective_action === "accepted";
    const ctx = rowContext(row);

    examples.push({
      eventId: row.id,
      x: tracker.features(ctx),
      reward: accepted ? 1 : 0,
      shownAt: row.shown_at,
      restaurantId: row.restaurant_id,
      userId: row.user_id,
      policyScore: row.policy_score,
      policy: row.policy,
    });

    // --- Pembaruan pencacah HARUS setelah fitur dibuat -----------------------
    tracker.observe(ctx, accepted);
  }

  return examples;
}
