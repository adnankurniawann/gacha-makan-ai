/**
 * Kebijakan pemilihan kandidat, dari yang paling sederhana sampai Thompson
 * Sampling di atas regresi linear Bayesian.
 *
 * Semua kebijakan memakai antarmuka yang sama, `select(candidates) → indeks`,
 * supaya bisa dijalankan di lingkungan simulasi yang sama persis. Perbandingan
 * yang setiap kebijakannya punya jalur kode sendiri bukan perbandingan.
 */

import {
  cholesky,
  createRng,
  dot,
  matVec,
  scaledIdentity,
  sampleMultivariateNormal,
  shermanMorrison,
  zeros,
  type Matrix,
  type Vector,
} from "@/lib/ml/linalg";

export interface Policy {
  readonly name: string;
  /** Memilih satu kandidat dan mengembalikan indeksnya. */
  select(candidates: Vector[]): number;
  /** Menerima hasil dari kandidat yang dipilih. */
  update(x: Vector, reward: number): void;
}

/**
 * Regresi linear Bayesian dengan prior `N(0, λ⁻¹I)`.
 *
 * Menyimpan A⁻¹ langsung, bukan A, karena setiap pemakaian membutuhkan
 * inversnya — dan Sherman–Morrison memperbaruinya dengan O(d²) alih-alih
 * membalik ulang dengan O(d³) tiap ronde.
 *
 * θ dibagi ke SEMUA restoran, bukan satu θ per restoran. Konsekuensinya
 * penting: restoran yang belum pernah ditayangkan tetap mendapat skor masuk
 * akal dari fitur kategori, jarak, dan harganya. Cold start item selesai
 * secara struktural, bukan lewat aturan khusus.
 */
export class BayesianLinearModel {
  private aInverse: Matrix;
  private b: Vector;

  constructor(
    readonly dim: number,
    /** Kekuatan prior. Makin besar, makin lambat model bergerak dari nol. */
    readonly lambda = 1,
    /**
     * Skala derau observasi; mengendalikan seberapa berani eksplorasinya.
     *
     * Nilai bawaannya jauh di bawah 1 dengan sengaja. Dengan 26 dimensi dan
     * hadiah biner, posterior yang lebar membuat θ̃ melompat terlalu jauh tiap
     * ronde, dan Thompson berubah jadi hampir-acak — kalah bahkan dari
     * epsilon-greedy. Ini parameter pertama yang harus dicurigai kalau
     * hasilnya mengecewakan.
     */
    readonly sigma = 0.3,
  ) {
    this.aInverse = scaledIdentity(dim, 1 / lambda);
    this.b = zeros(dim);
  }

  /** Estimasi titik θ̂ = A⁻¹b. */
  theta(): Vector {
    return matVec(this.aInverse, this.b);
  }

  /** Varians prediksi untuk satu kandidat: xᵀA⁻¹x. */
  variance(x: Vector): number {
    return dot(x, matVec(this.aInverse, x));
  }

  /**
   * Satu tarikan dari posterior `N(θ̂, σ²A⁻¹)`.
   *
   * Di sinilah eksplorasi muncul: kandidat yang jarang ditayangkan punya
   * varians besar, jadi sesekali menang lotere sampling. Tidak ada `epsilon`
   * yang perlu di-tuning tangan.
   */
  sampleTheta(rng: () => number): Vector {
    const scaled = this.aInverse.map((row) =>
      row.map((value) => value * this.sigma * this.sigma),
    );
    return sampleMultivariateNormal(this.theta(), cholesky(scaled), rng);
  }

  update(x: Vector, reward: number): void {
    this.aInverse = shermanMorrison(this.aInverse, x);
    for (let i = 0; i < this.dim; i += 1) {
      this.b[i] += reward * x[i];
    }
  }

  /**
   * Faktor Cholesky dari `σ²A⁻¹`, yaitu `L` dengan `L Lᵀ = σ²A⁻¹`.
   *
   * Ini satu-satunya bagian posterior yang mahal dihitung, dan ia tidak
   * berubah di antara pembaruan. Menyimpannya di artefak model berarti
   * penyajian online cukup mengalikan `L z` — tidak ada dekomposisi yang perlu
   * diulang tiap permintaan.
   */
  covarianceCholesky(): Matrix {
    return cholesky(
      this.aInverse.map((row) => row.map((value) => value * this.sigma * this.sigma)),
    );
  }
}

function argmax(scores: number[]): number {
  let best = 0;
  for (let i = 1; i < scores.length; i += 1) {
    if (scores[i] > scores[best]) best = i;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Kebijakan
// ---------------------------------------------------------------------------

/** Perilaku aplikasi sebelum ada model. Ini yang harus dikalahkan. */
export function uniformRandomPolicy(seed: number): Policy {
  const rng = createRng(seed);
  return {
    name: "uniform_random",
    select: (candidates) => Math.floor(rng() * candidates.length),
    update: () => {},
  };
}

/**
 * Selalu ambil yang terdekat. Baseline non-ML yang masuk akal, dan sering
 * mengejutkan kuat — kalau model tidak bisa mengalahkan ini, model itu belum
 * layak dipakai.
 *
 * Membaca fitur jarak `1/(1+km)` di indeks 1, yang menurun seiring jarak.
 */
export function nearestPolicy(distanceIndex = 1): Policy {
  return {
    name: "jarak_terdekat",
    select: (candidates) => argmax(candidates.map((x) => x[distanceIndex])),
    update: () => {},
  };
}

/** Bandit paling sederhana: eksploitasi, sesekali menembak acak. */
export function epsilonGreedyPolicy(
  dim: number,
  seed: number,
  epsilon = 0.1,
  lambda = 1,
): Policy {
  const rng = createRng(seed);
  const model = new BayesianLinearModel(dim, lambda);

  return {
    name: `epsilon_greedy_${epsilon}`,
    select(candidates) {
      if (rng() < epsilon) return Math.floor(rng() * candidates.length);
      const theta = model.theta();
      return argmax(candidates.map((x) => dot(theta, x)));
    },
    update: (x, reward) => model.update(x, reward),
  };
}

/**
 * LinUCB: skor titik ditambah bonus sebanding akar varians.
 *
 * Pembanding bandit kontekstual yang optimis alih-alih menarik sampel. Ia
 * deterministik, jadi sering lebih stabil di awal — dan itu yang membuatnya
 * pembanding yang jujur untuk Thompson.
 */
export function linUcbPolicy(dim: number, alpha = 1, lambda = 1): Policy {
  const model = new BayesianLinearModel(dim, lambda);

  return {
    name: `linucb_${alpha}`,
    select(candidates) {
      const theta = model.theta();
      return argmax(
        candidates.map((x) => dot(theta, x) + alpha * Math.sqrt(model.variance(x))),
      );
    },
    update: (x, reward) => model.update(x, reward),
  };
}

/** Kandidat utama. */
export function thompsonSamplingPolicy(
  dim: number,
  seed: number,
  lambda = 1,
  sigma = 0.3,
): Policy {
  const rng = createRng(seed);
  const model = new BayesianLinearModel(dim, lambda, sigma);

  return {
    name: "thompson_sampling",
    select(candidates) {
      // Satu tarikan θ̃ per ronde, dipakai untuk menilai SEMUA kandidat.
      // Menarik θ̃ terpisah per kandidat akan memecah korelasi antar-kandidat
      // dan membuat eksplorasinya jauh lebih berisik dari yang seharusnya.
      const theta = model.sampleTheta(rng);
      return argmax(candidates.map((x) => dot(theta, x)));
    },
    update: (x, reward) => model.update(x, reward),
  };
}

/**
 * Batas atas: tahu θ* yang sebenarnya. Tidak bisa dipakai di dunia nyata —
 * gunanya hanya sebagai pembanding untuk menghitung regret.
 */
export function oraclePolicy(trueTheta: Vector): Policy {
  return {
    name: "oracle",
    select: (candidates) => argmax(candidates.map((x) => dot(trueTheta, x))),
    update: () => {},
  };
}
