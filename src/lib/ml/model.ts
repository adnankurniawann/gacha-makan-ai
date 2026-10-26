/**
 * Artefak model dan penyajiannya.
 *
 * Model linear berarti inferensi cuma satu perkalian matriks-vektor 26×26.
 * Itu tidak butuh Python, tidak butuh FastAPI, tidak butuh container tambahan,
 * dan tidak butuh cold start serverless kedua. Arsitekturnya tetap monolith
 * Next.js.
 *
 * Ini keputusan yang disengaja: memilih model yang cukup sederhana untuk
 * di-deploy di dalam stack yang sudah ada, alih-alih menambah kompleksitas
 * demi model yang lebih canggih beberapa persen.
 *
 * ## Kenapa pelatihannya juga TypeScript, bukan Python
 *
 * Roadmap menyarankan latihan offline di Python. Untuk proyek ini itu justru
 * berbahaya: fitur dibangun oleh `buildFeatureVector`, dan menulis ulangnya di
 * Python berarti dua implementasi yang cepat atau lambat berbeda. Vektor saat
 * pelatihan tidak akan sama dengan vektor saat penyajian, dan bug seperti itu
 * tidak muncul di test mana pun sampai modelnya sudah dipakai orang.
 *
 * Satu bahasa, satu fungsi fitur, satu perilaku.
 */

import { BayesianLinearModel } from "@/lib/ml/bandit";
import { FEATURE_DIM, FEATURE_NAMES } from "@/lib/ml/features";
import {
  dot,
  sampleMultivariateNormal,
  type Matrix,
  type Vector,
} from "@/lib/ml/linalg";
import type { TrainingExample } from "@/lib/ml/training";

/** Dinaikkan kalau bentuk artefaknya berubah dengan cara yang tidak kompatibel. */
export const MODEL_FORMAT_VERSION = 1;

export interface ModelArtifact {
  formatVersion: number;
  featureDim: number;
  /**
   * Nama fitur menurut urutannya saat model dilatih.
   *
   * Disimpan supaya ketidakcocokan ketahuan saat memuat, bukan saat
   * merekomendasikan. Kalau seseorang menyisipkan satu blok fitur di tengah,
   * seluruh bobot bergeser satu posisi — modelnya tetap "jalan" dan
   * rekomendasinya jadi omong kosong tanpa satu pun error.
   */
  featureNames: string[];
  policy: string;
  lambda: number;
  sigma: number;
  trainedAt: string;
  /** Berapa contoh yang dipakai. Dipakai untuk menolak model yang terlalu tipis. */
  examples: number;
  /** θ̂ = A⁻¹b */
  theta: number[];
  /** L segitiga bawah dengan L Lᵀ = σ²A⁻¹ */
  cholesky: number[][];
}

export interface TrainOptions {
  lambda?: number;
  sigma?: number;
  policy?: string;
}

/**
 * Melatih model dari contoh yang sudah bebas kebocoran.
 *
 * Masukannya harus datang dari `buildTrainingSet`, yang menjamin fitur tiap
 * baris hanya melihat peristiwa sebelumnya.
 */
export function trainModel(
  examples: TrainingExample[],
  options: TrainOptions = {},
): ModelArtifact {
  const lambda = options.lambda ?? 1;
  const sigma = options.sigma ?? 0.3;

  const model = new BayesianLinearModel(FEATURE_DIM, lambda, sigma);

  for (const example of examples) {
    if (example.x.length !== FEATURE_DIM) {
      throw new Error(
        `trainModel: contoh "${example.eventId}" punya ${example.x.length} dimensi, ` +
          `bukan ${FEATURE_DIM}.`,
      );
    }
    model.update(example.x, example.reward);
  }

  return {
    formatVersion: MODEL_FORMAT_VERSION,
    featureDim: FEATURE_DIM,
    featureNames: [...FEATURE_NAMES],
    policy: options.policy ?? "thompson_v1",
    lambda,
    sigma,
    trainedAt: new Date().toISOString(),
    examples: examples.length,
    theta: model.theta(),
    cholesky: model.covarianceCholesky(),
  };
}

export class ModelLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelLoadError";
  }
}

/**
 * Memvalidasi artefak sebelum dipakai.
 *
 * Melempar, bukan mengembalikan model yang cacat. Model rekomendasi yang salah
 * tidak menghasilkan error — ia menghasilkan saran buruk yang terlihat wajar,
 * dan itu jauh lebih sulit disadari.
 */
export function parseModelArtifact(raw: unknown): ModelArtifact {
  if (raw === null || typeof raw !== "object") {
    throw new ModelLoadError("Artefak model bukan objek.");
  }

  const artifact = raw as Partial<ModelArtifact>;

  if (artifact.formatVersion !== MODEL_FORMAT_VERSION) {
    throw new ModelLoadError(
      `Versi format artefak ${artifact.formatVersion} tidak didukung ` +
        `(yang didukung: ${MODEL_FORMAT_VERSION}).`,
    );
  }

  if (artifact.featureDim !== FEATURE_DIM) {
    throw new ModelLoadError(
      `Model dilatih untuk ${artifact.featureDim} dimensi, kode ini memakai ${FEATURE_DIM}.`,
    );
  }

  if (
    !Array.isArray(artifact.featureNames) ||
    artifact.featureNames.length !== FEATURE_NAMES.length ||
    artifact.featureNames.some((name, index) => name !== FEATURE_NAMES[index])
  ) {
    // Pemeriksaan terpenting di berkas ini. Satu blok fitur yang disisipkan di
    // tengah menggeser seluruh bobot, dan modelnya akan tetap "jalan".
    throw new ModelLoadError(
      "Susunan fitur model tidak cocok dengan kode ini. Latih ulang modelnya.",
    );
  }

  if (!Array.isArray(artifact.theta) || artifact.theta.length !== FEATURE_DIM) {
    throw new ModelLoadError("Vektor theta tidak berukuran benar.");
  }

  if (artifact.theta.some((value) => !Number.isFinite(value))) {
    throw new ModelLoadError("Vektor theta mengandung nilai tak terhingga.");
  }

  if (
    !Array.isArray(artifact.cholesky) ||
    artifact.cholesky.length !== FEATURE_DIM ||
    artifact.cholesky.some(
      (row) => !Array.isArray(row) || row.length !== FEATURE_DIM,
    )
  ) {
    throw new ModelLoadError("Matriks Cholesky tidak berukuran benar.");
  }

  return artifact as ModelArtifact;
}

export interface LoadedModel {
  readonly artifact: ModelArtifact;
  /** Skor rata-rata posterior; deterministik, tanpa eksplorasi. */
  scoreGreedy(candidates: Vector[]): number[];
  /**
   * Memilih satu kandidat lewat Thompson Sampling.
   *
   * Satu tarikan θ̃ per permintaan, dipakai untuk menilai SEMUA kandidat.
   */
  select(candidates: Vector[], rng: () => number): number;
}

/**
 * Menyiapkan artefak untuk penyajian.
 *
 * Cholesky-nya sudah ikut di artefak, jadi pemuatan tidak melakukan
 * dekomposisi apa pun — yang tersisa saat permintaan datang hanyalah perkalian
 * matriks-vektor.
 */
export function loadModel(raw: unknown): LoadedModel {
  const artifact = parseModelArtifact(raw);
  const theta: Vector = artifact.theta;
  const L: Matrix = artifact.cholesky;

  return {
    artifact,

    scoreGreedy(candidates) {
      return candidates.map((x) => dot(theta, x));
    },

    select(candidates, rng) {
      if (candidates.length === 0) {
        throw new Error("select: tidak ada kandidat untuk dipilih.");
      }

      const sampled = sampleMultivariateNormal(theta, L, rng);

      let best = 0;
      let bestScore = dot(sampled, candidates[0]);
      for (let i = 1; i < candidates.length; i += 1) {
        const score = dot(sampled, candidates[i]);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      return best;
    },
  };
}
