/**
 * Kebijakan Thompson Sampling untuk penyajian — dengan propensity yang jujur.
 *
 * `loadModel().select()` cukup untuk simulasi, tapi tidak untuk produksi:
 * ia mengambil argmax dari SATU tarikan θ̃, dan peluang sebuah kandidat
 * menang di bawah aturan itu tidak punya bentuk tertutup. Tanpa peluang itu,
 * `spin_events.policy_score` untuk baris bandit tidak bisa diisi, dan log dari
 * kebijakan baru tidak bisa dipakai untuk evaluasi off-policy berikutnya —
 * persis kesalahan yang dulu hampir terjadi pada `weighted_budget_v1`.
 *
 * Jalan keluarnya: tarik θ̃ sebanyak K kali, hitung seberapa sering tiap
 * kandidat menang, campur dengan sedikit peluang seragam, lalu UNDI dari
 * distribusi itu. Karena pengundian benar-benar dilakukan dari distribusi
 * yang dicatat, `policy_score` adalah peluang yang sebenarnya, bukan perkiraan
 * di atas perkiraan.
 *
 * Campuran seragam (ε) punya dua tugas: menjamin tidak ada kandidat yang
 * peluangnya nol — yang membuat bobot IPS tak terhingga — dan menjaga sedikit
 * eksplorasi bahkan setelah posterior menyempit.
 */

import type { ModelArtifact } from "@/lib/ml/model";
import { dot, sampleMultivariateNormal, type Vector } from "@/lib/ml/linalg";

/** Nilai `spin_events.policy` untuk baris yang dipilih bandit. */
export const BANDIT_POLICY = "thompson_v1";

/** Berapa tarikan θ̃ per permintaan. */
export const DEFAULT_SAMPLES = 200;

/** Porsi peluang yang dibagi rata ke semua kandidat. */
export const DEFAULT_EPSILON = 0.1;

export interface ThompsonOptions {
  samples?: number;
  epsilon?: number;
}

/**
 * Peluang tiap kandidat terpilih.
 *
 * Hasilnya selalu berjumlah 1 dan setiap entri ≥ ε/n.
 */
export function thompsonProbabilities(
  artifact: Pick<ModelArtifact, "theta" | "cholesky">,
  candidates: Vector[],
  rng: () => number,
  options: ThompsonOptions = {},
): number[] {
  const n = candidates.length;
  if (n === 0) return [];
  if (n === 1) return [1];

  const samples = Math.max(1, Math.floor(options.samples ?? DEFAULT_SAMPLES));
  const epsilon = Math.min(1, Math.max(0, options.epsilon ?? DEFAULT_EPSILON));

  const wins = new Array<number>(n).fill(0);
  for (let k = 0; k < samples; k += 1) {
    const theta = sampleMultivariateNormal(artifact.theta, artifact.cholesky, rng);
    let best = 0;
    let bestScore = dot(theta, candidates[0]);
    for (let i = 1; i < n; i += 1) {
      const score = dot(theta, candidates[i]);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    wins[best] += 1;
  }

  return wins.map((count) => (1 - epsilon) * (count / samples) + epsilon / n);
}

/** Mengundi satu indeks dari distribusi peluang. */
export function drawIndex(probabilities: number[], rng: () => number): number {
  let remaining = rng();
  for (let i = 0; i < probabilities.length; i += 1) {
    remaining -= probabilities[i];
    if (remaining < 0) return i;
  }
  // Galat pembulatan bisa menyisakan sedikit di ujung.
  return probabilities.length - 1;
}

export interface PolicyDecision {
  index: number;
  /** Peluang indeks ini terundi — yang dicatat sebagai `policy_score`. */
  propensity: number;
}

export function decideThompson(
  artifact: Pick<ModelArtifact, "theta" | "cholesky">,
  candidates: Vector[],
  rng: () => number,
  options: ThompsonOptions = {},
): PolicyDecision {
  if (candidates.length === 0) {
    throw new Error("decideThompson: tidak ada kandidat untuk dipilih.");
  }
  const probabilities = thompsonProbabilities(artifact, candidates, rng, options);
  const index = drawIndex(probabilities, rng);
  return { index, propensity: probabilities[index] };
}

/**
 * Apakah kunci ini masuk kelompok perlakuan.
 *
 * Deterministik — hash FNV-1a, bukan `Math.random()` — supaya satu pengguna
 * tetap di kelompok yang sama di setiap spin. Pengguna yang berpindah-pindah
 * kelompok membuat perbandingan A/B mengukur campuran keduanya.
 */
export function inRollout(key: string, fraction: number): boolean {
  if (!(fraction > 0)) return false;
  if (fraction >= 1) return true;

  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000 < fraction;
}
