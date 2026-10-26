import { describe, expect, it } from "vitest";

import {
  cholesky,
  createRng,
  dot,
  matVec,
  sampleMultivariateNormal,
  scaledIdentity,
  shermanMorrison,
  sigmoid,
  standardNormal,
  type Matrix,
} from "@/lib/ml/linalg";

/** Invers naif lewat eliminasi Gauss–Jordan, hanya untuk membandingkan. */
function naiveInverse(A: Matrix): Matrix {
  const d = A.length;
  const M = A.map((row, i) => [
    ...row,
    ...Array.from({ length: d }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < d; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < d; row += 1) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const scale = M[col][col];
    for (let j = 0; j < 2 * d; j += 1) M[col][j] /= scale;

    for (let row = 0; row < d; row += 1) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = 0; j < 2 * d; j += 1) M[row][j] -= factor * M[col][j];
    }
  }

  return M.map((row) => row.slice(d));
}

function multiply(A: Matrix, B: Matrix): Matrix {
  return A.map((row) =>
    B[0].map((_, j) => row.reduce((sum, value, k) => sum + value * B[k][j], 0)),
  );
}

describe("operasi dasar", () => {
  it("membuat identitas berskala", () => {
    expect(scaledIdentity(3, 2)).toEqual([
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ]);
  });

  it("menghitung hasil kali titik dan matriks-vektor", () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(matVec([[1, 2], [3, 4]], [1, 1])).toEqual([3, 7]);
  });
});

describe("shermanMorrison", () => {
  it("sama dengan membalik (A + x xᵀ) secara langsung", () => {
    // Ini yang membuat pelatihan online murah — dan kalau identitasnya salah
    // diterapkan, modelnya tetap "jalan" tapi belajar hal yang keliru.
    const A: Matrix = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ];
    const x = [0.5, -1.2, 0.3];

    const updated = shermanMorrison(naiveInverse(A), x);

    const expected = naiveInverse(
      A.map((row, i) => row.map((value, j) => value + x[i] * x[j])),
    );

    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        expect(updated[i][j]).toBeCloseTo(expected[i][j], 10);
      }
    }
  });

  it("tidak mengubah matriks masukannya", () => {
    const Ainv = scaledIdentity(3);
    const salinan = Ainv.map((row) => [...row]);
    shermanMorrison(Ainv, [1, 2, 3]);
    expect(Ainv).toEqual(salinan);
  });

  it("tetap benar setelah banyak pembaruan berturut-turut", () => {
    // Galat pembulatan bisa menumpuk; 200 pembaruan jauh lebih banyak dari
    // yang dilakukan satu sesi simulasi per dimensi.
    const d = 5;
    const rng = createRng(7);
    let Ainv = scaledIdentity(d);
    let A = scaledIdentity(d);

    for (let step = 0; step < 200; step += 1) {
      const x = Array.from({ length: d }, () => rng() * 2 - 1);
      Ainv = shermanMorrison(Ainv, x);
      A = A.map((row, i) => row.map((value, j) => value + x[i] * x[j]));
    }

    const product = multiply(A, Ainv);
    for (let i = 0; i < d; i += 1) {
      for (let j = 0; j < d; j += 1) {
        expect(product[i][j]).toBeCloseTo(i === j ? 1 : 0, 6);
      }
    }
  });
});

describe("cholesky", () => {
  it("menghasilkan L dengan L Lᵀ sama dengan A", () => {
    const A: Matrix = [
      [4, 2, 1],
      [2, 3, 0.5],
      [1, 0.5, 2],
    ];
    const L = cholesky(A);

    const reconstructed = multiply(
      L,
      L[0].map((_, j) => L.map((row) => row[j])),
    );

    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        expect(reconstructed[i][j]).toBeCloseTo(A[i][j], 10);
      }
    }
  });

  it("menghasilkan matriks segitiga bawah", () => {
    const L = cholesky(scaledIdentity(4, 2));
    for (let i = 0; i < 4; i += 1) {
      for (let j = i + 1; j < 4; j += 1) {
        expect(L[i][j]).toBe(0);
      }
    }
  });

  it("melempar untuk matriks yang tidak definit positif", () => {
    // Mengembalikan angka diam-diam akan menyembunyikan bug di pemanggil.
    expect(() => cholesky([[1, 2], [2, 1]])).toThrow(/definit positif/);
  });
});

describe("pembangkit acak", () => {
  it("berulang persis untuk benih yang sama", () => {
    // Hasil simulasi yang tidak bisa diulang tidak bisa diperiksa siapa pun.
    const a = createRng(42);
    const b = createRng(42);
    const first = Array.from({ length: 10 }, () => a());
    const second = Array.from({ length: 10 }, () => b());
    expect(first).toEqual(second);
  });

  it("berbeda untuk benih berbeda", () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });

  it("menghasilkan nilai di [0, 1)", () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("standardNormal", () => {
  it("punya rata-rata mendekati nol dan simpangan baku mendekati satu", () => {
    const rng = createRng(2026);
    const samples = Array.from({ length: 20000 }, () => standardNormal(rng));

    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const variance =
      samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;

    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.sqrt(variance)).toBeGreaterThan(0.95);
    expect(Math.sqrt(variance)).toBeLessThan(1.05);
  });

  it("selalu terhingga", () => {
    const rng = createRng(5);
    for (let i = 0; i < 5000; i += 1) {
      expect(Number.isFinite(standardNormal(rng))).toBe(true);
    }
  });
});

describe("sampleMultivariateNormal", () => {
  it("memusat di mean-nya", () => {
    const rng = createRng(11);
    const mean = [3, -2];
    const L = cholesky([
      [1, 0],
      [0, 1],
    ]);

    const samples = Array.from({ length: 5000 }, () =>
      sampleMultivariateNormal(mean, L, rng),
    );

    const avg0 = samples.reduce((sum, s) => sum + s[0], 0) / samples.length;
    const avg1 = samples.reduce((sum, s) => sum + s[1], 0) / samples.length;

    expect(avg0).toBeCloseTo(3, 1);
    expect(avg1).toBeCloseTo(-2, 1);
  });

  it("kovariansnya mengikuti L Lᵀ", () => {
    const rng = createRng(13);
    // Varians 4 di dimensi pertama, 0.25 di kedua.
    const L = cholesky([
      [4, 0],
      [0, 0.25],
    ]);

    const samples = Array.from({ length: 20000 }, () =>
      sampleMultivariateNormal([0, 0], L, rng),
    );

    const var0 =
      samples.reduce((sum, s) => sum + s[0] ** 2, 0) / samples.length;
    const var1 =
      samples.reduce((sum, s) => sum + s[1] ** 2, 0) / samples.length;

    expect(var0).toBeGreaterThan(3.5);
    expect(var0).toBeLessThan(4.5);
    expect(var1).toBeGreaterThan(0.2);
    expect(var1).toBeLessThan(0.3);
  });
});

describe("sigmoid", () => {
  it("bernilai setengah di nol dan monoton naik", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(1)).toBeGreaterThan(sigmoid(0));
    expect(sigmoid(-1)).toBeLessThan(sigmoid(0));
  });

  it("stabil untuk nilai ekstrem di kedua arah", () => {
    // exp(710) meluap jadi Infinity dan menghasilkan NaN kalau rumusnya naif.
    expect(sigmoid(1000)).toBe(1);
    expect(sigmoid(-1000)).toBe(0);
    expect(Number.isFinite(sigmoid(-750))).toBe(true);
  });
});
