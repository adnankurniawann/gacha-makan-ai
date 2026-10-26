/**
 * Evaluasi off-policy dari log — lihat docs/PENGEMBANGAN-AI.md.
 *
 * Pertanyaannya: seandainya kebijakan baru yang memilih pada penayangan yang
 * sudah tercatat, berapa accept rate-nya? Dijawab tanpa menayangkan apa pun
 * ke pengguna, jadi ini juga "shadow mode": model menilai setiap kandidat
 * yang pernah tersedia, tapi tidak pernah memengaruhi hasil spin.
 *
 * Replay polos tidak sah di sini karena kebijakan pengumpulnya berbobot harga.
 * Yang dipakai adalah inverse propensity scoring:
 *
 *   IPS   = (1/n) Σ  π_baru(a|x) · r / p_lama(a|x)
 *   SNIPS = Σ w·r / Σ w,   w = π_baru(a|x) / p_lama(a|x)
 *
 * π_baru berupa peluang, bukan indikator "sama dengan yang tercatat" — untuk
 * kebijakan stokastik seperti Thompson itu estimator yang sama tak biasnya
 * dengan varians lebih kecil. SNIPS sedikit bias tapi jauh lebih stabil saat
 * datanya tipis, jadi itu angka utama; IPS dilaporkan di sampingnya.
 */

import { createRng } from "@/lib/ml/linalg";
import {
  chronological,
  PriorTracker,
  rowContext,
  type ImpressionContext,
  type RawSpinRow,
} from "@/lib/ml/training";

/** Kategori dan harga kandidat, direkonstruksi dari katalog saat analisis. */
export interface CatalogEntry {
  category: string | null;
  price_tier: number | null;
}

/** Peluang kebijakan memilih tiap kandidat, sejajar indeks dengan `xs`. */
export type CandidatePolicy = (xs: number[][], rng: () => number) => number[];

export interface EvaluationOptions {
  /** Hanya baris dengan `shown_at` ≥ ini yang dinilai. Riwayat sebelumnya tetap mengisi fitur. */
  evaluateFrom?: string;
  seed?: number;
  bootstrapSamples?: number;
}

export interface EvaluationResult {
  /** Baris yang benar-benar dinilai. */
  n: number;
  /** Baris yang dilewati, per alasan — dilaporkan supaya tidak ada yang hilang diam-diam. */
  skipped: Record<string, number>;
  /** Accept rate kebijakan yang mengumpulkan log, di baris yang sama. */
  loggedAcceptRate: number;
  ips: number;
  snips: number;
  /** Interval 95% SNIPS dari bootstrap. */
  snipsCi: [number, number];
  /**
   * Effective sample size, (Σw)²/Σw². Kalau jauh di bawah n, sebagian kecil
   * baris berbobot besar yang menentukan hasilnya — percayai angkanya lebih
   * sedikit.
   */
  effectiveSampleSize: number;
}

interface Scored {
  weight: number;
  reward: number;
}

function snipsOf(items: Scored[]): number {
  let num = 0;
  let den = 0;
  for (const { weight, reward } of items) {
    num += weight * reward;
    den += weight;
  }
  return den > 0 ? num / den : 0;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Menilai satu kebijakan pada log.
 *
 * Fitur tiap kandidat dihitung dengan `PriorTracker` yang sama dengan
 * pelatihan dan penyajian, dari riwayat SEBELUM penayangan itu saja. Kalau
 * fiturnya dihitung dari seluruh dataset, masa depan bocor ke masa lalu dan
 * hasilnya akan terlihat spektakuler sekaligus tidak berarti apa-apa.
 */
export function evaluatePolicy(
  rows: RawSpinRow[],
  catalog: Map<string, CatalogEntry>,
  policy: CandidatePolicy,
  options: EvaluationOptions = {},
): EvaluationResult {
  const rng = createRng(options.seed ?? 20261026);
  const tracker = new PriorTracker();
  const evaluateFrom = options.evaluateFrom ? Date.parse(options.evaluateFrom) : -Infinity;

  const scored: Scored[] = [];
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  let loggedAccepts = 0;

  for (const row of chronological(rows)) {
    if (row.effective_action === null || row.effective_action === undefined) {
      skip("belum berlabel");
      continue;
    }

    const accepted = row.effective_action === "accepted";
    const logged = rowContext(row);

    if (Date.parse(row.shown_at) >= evaluateFrom) {
      const ids = row.candidate_ids ?? null;
      const distances = row.candidate_distances_m ?? null;
      const loggedIndex = ids ? ids.indexOf(row.restaurant_id) : -1;

      if (!ids || !distances || ids.length !== distances.length || ids.length === 0) {
        skip("tanpa arm set");
      } else if (loggedIndex < 0) {
        skip("restoran terpilih tidak ada di arm set");
      } else if (!(typeof row.policy_score === "number" && row.policy_score > 0)) {
        skip("tanpa policy_score");
      } else {
        const xs = ids.map((id, i) => {
          // Kandidat yang terpilih memakai kategori dan harga yang tercatat di
          // barisnya; sisanya direkonstruksi dari katalog sekarang.
          const entry: CatalogEntry =
            i === loggedIndex
              ? { category: row.category, price_tier: row.price_tier }
              : (catalog.get(id) ?? { category: null, price_tier: null });
          const ctx: ImpressionContext = {
            ...logged,
            restaurantId: id,
            category: entry.category,
            priceTier: entry.price_tier,
            distanceKm: distances[i] / 1000,
          };
          return tracker.features(ctx);
        });

        const probabilities = policy(xs, rng);
        scored.push({
          weight: probabilities[loggedIndex] / row.policy_score,
          reward: accepted ? 1 : 0,
        });
        if (accepted) loggedAccepts += 1;
      }
    }

    // Selalu sesudah penilaian, dan untuk semua baris berlabel — termasuk yang
    // dilewati — supaya riwayatnya sama dengan yang dilihat pelatihan.
    tracker.observe(logged, accepted);
  }

  const n = scored.length;
  let sumW = 0;
  let sumW2 = 0;
  let sumWR = 0;
  for (const { weight, reward } of scored) {
    sumW += weight;
    sumW2 += weight * weight;
    sumWR += weight * reward;
  }

  const bootstrapSamples = options.bootstrapSamples ?? 1000;
  const estimates: number[] = [];
  if (n > 0) {
    for (let b = 0; b < bootstrapSamples; b += 1) {
      const resample: Scored[] = new Array(n);
      for (let i = 0; i < n; i += 1) resample[i] = scored[Math.floor(rng() * n)];
      estimates.push(snipsOf(resample));
    }
    estimates.sort((a, b) => a - b);
  }

  return {
    n,
    skipped,
    loggedAcceptRate: n > 0 ? loggedAccepts / n : 0,
    ips: n > 0 ? sumWR / n : 0,
    snips: snipsOf(scored),
    snipsCi: [quantile(estimates, 0.025), quantile(estimates, 0.975)],
    effectiveSampleSize: sumW2 > 0 ? (sumW * sumW) / sumW2 : 0,
  };
}

/** Pembanding: undian seragam di antara kandidat. */
export const uniformPolicy: CandidatePolicy = (xs) => xs.map(() => 1 / xs.length);
