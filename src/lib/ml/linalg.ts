/**
 * Aljabar linear seperlunya untuk bandit 26 dimensi.
 *
 * Ditulis sendiri, tanpa dependensi. Bukan karena tidak ada library yang
 * bagus, tapi karena yang dibutuhkan cuma lima fungsi pada matriks 26×26 —
 * dan di Fase 3 kode ini harus ikut jalan di dalam route handler Next.js tanpa
 * menambah satu byte pun ke bundle yang tidak dipakai.
 *
 * Semua matriks berbentuk baris-mayor: `A[i][j]` adalah baris i, kolom j.
 */

export type Matrix = number[][];
export type Vector = number[];

/** Matriks identitas d×d dikali `scale`. */
export function scaledIdentity(d: number, scale = 1): Matrix {
  const result: Matrix = [];
  for (let i = 0; i < d; i += 1) {
    const row = new Array<number>(d).fill(0);
    row[i] = scale;
    result.push(row);
  }
  return result;
}

export function zeros(d: number): Vector {
  return new Array<number>(d).fill(0);
}

export function dot(a: Vector, b: Vector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

/** A · x */
export function matVec(A: Matrix, x: Vector): Vector {
  const result = new Array<number>(A.length).fill(0);
  for (let i = 0; i < A.length; i += 1) {
    result[i] = dot(A[i], x);
  }
  return result;
}

/**
 * Pembaruan rank-1 terhadap **invers** matriks, lewat identitas
 * Sherman–Morrison:
 *
 *     (A + x xᵀ)⁻¹ = A⁻¹ − (A⁻¹ x)(xᵀ A⁻¹) / (1 + xᵀ A⁻¹ x)
 *
 * Ini yang membuat pelatihan online murah: menyimpan A lalu membaliknya tiap
 * ronde memakan O(d³); memperbarui inversnya langsung memakan O(d²).
 *
 * Aman karena A selalu dimulai dari λI dengan λ > 0 dan hanya ditambah xxᵀ
 * yang semidefinit positif, jadi penyebutnya tidak pernah nol.
 *
 * @returns Matriks baru; masukannya tidak diubah.
 */
export function shermanMorrison(Ainv: Matrix, x: Vector): Matrix {
  const d = Ainv.length;
  const Ainv_x = matVec(Ainv, x);
  const denominator = 1 + dot(x, Ainv_x);

  const result: Matrix = [];
  for (let i = 0; i < d; i += 1) {
    const row = new Array<number>(d);
    for (let j = 0; j < d; j += 1) {
      row[j] = Ainv[i][j] - (Ainv_x[i] * Ainv_x[j]) / denominator;
    }
    result.push(row);
  }
  return result;
}

/**
 * Dekomposisi Cholesky: mencari L segitiga bawah dengan `A = L Lᵀ`.
 *
 * Dipakai untuk mengambil sampel dari sebaran normal multivariat. Melempar
 * kalau A tidak definit positif — itu selalu berarti ada yang salah di
 * pemanggil (biasanya λ terlalu kecil sampai A⁻¹ kehilangan sifatnya karena
 * pembulatan), dan mengembalikan angka diam-diam akan menyembunyikannya.
 */
export function cholesky(A: Matrix): Matrix {
  const d = A.length;
  const L: Matrix = Array.from({ length: d }, () => new Array<number>(d).fill(0));

  for (let i = 0; i < d; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = A[i][j];
      for (let k = 0; k < j; k += 1) {
        sum -= L[i][k] * L[j][k];
      }

      if (i === j) {
        if (sum <= 0) {
          throw new Error(
            `cholesky: matriks tidak definit positif (pivot ${sum} di indeks ${i}). ` +
              "Biasanya berarti λ terlalu kecil untuk menahan galat pembulatan.",
          );
        }
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }

  return L;
}

/**
 * Pembangkit angka acak berbenih.
 *
 * `Math.random` tidak bisa diulang, dan hasil simulasi yang tidak bisa diulang
 * tidak bisa diperiksa siapa pun — termasuk oleh kita sendiri minggu depan.
 * Algoritmanya mulberry32: pendek, cukup baik untuk simulasi, dan bukan untuk
 * keperluan keamanan apa pun.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Satu tarikan dari normal baku, lewat transformasi Box–Muller. */
export function standardNormal(rng: () => number): number {
  // Nol dihindari karena log(0) tidak terhingga.
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Satu sampel dari `N(mean, L Lᵀ)`.
 *
 * Memakai `mean + L z` dengan `z` vektor normal baku — cara baku mengubah
 * sampel bulat jadi sampel dengan kovarians yang diinginkan.
 */
export function sampleMultivariateNormal(
  mean: Vector,
  L: Matrix,
  rng: () => number,
): Vector {
  const d = mean.length;
  const z = new Array<number>(d);
  for (let i = 0; i < d; i += 1) z[i] = standardNormal(rng);

  const result = new Array<number>(d);
  for (let i = 0; i < d; i += 1) {
    let sum = mean[i];
    // L segitiga bawah, jadi cukup sampai kolom i.
    for (let j = 0; j <= i; j += 1) sum += L[i][j] * z[j];
    result[i] = sum;
  }
  return result;
}

export function sigmoid(value: number): number {
  // Bentuk yang stabil untuk nilai besar di kedua arah; exp(710) meluap
  // jadi Infinity dan menghasilkan NaN.
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}
