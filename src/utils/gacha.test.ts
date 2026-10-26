import { describe, expect, it, vi } from "vitest";

import {
  calculateSpinWeights,
  selectionPropensity,
  weightedRandom,
  weightedRandomIndex,
} from "@/utils/gacha";

describe("calculateSpinWeights", () => {
  it("assigns a minimum weight of 1 to every candidate", () => {
    const weights = calculateSpinWeights(
      [
        { price_tier: 20000 },
        { price_tier: 25000 },
      ],
      20000
    );

    expect(weights).toEqual([1, 1]);
  });

  it("gives cheaper candidates a larger weight", () => {
    const weights = calculateSpinWeights(
      [
        { price_tier: 5000 },
        { price_tier: 15000 },
      ],
      20000
    );

    expect(weights).toEqual([15000, 5000]);
  });
});

describe("weightedRandom", () => {
  it("returns one of the input items using the provided weights", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.01);

    const result = weightedRandom(["a", "b", "c"], [1, 2, 3]);

    expect(result).toBe("a");
    randomSpy.mockRestore();
  });
});

describe("weightedRandomIndex", () => {
  it("memilih indeks sesuai bobot kumulatifnya", () => {
    // total = 6. Batasnya: [0,1) -> 0, [1,3) -> 1, [3,6) -> 2.
    const cases: Array<[number, number]> = [
      [0.01, 0],
      [0.3, 1],
      [0.9, 2],
    ];

    for (const [random, expected] of cases) {
      const spy = vi.spyOn(Math, "random").mockReturnValue(random);
      expect(weightedRandomIndex([1, 2, 3])).toBe(expected);
      spy.mockRestore();
    }
  });

  it("menolak bobot yang tidak bisa dipakai", () => {
    expect(() => weightedRandomIndex([])).toThrow();
    expect(() => weightedRandomIndex([0, 0])).toThrow();
  });

  it("tidak pernah keluar dari rentang indeks yang sah", () => {
    // Kasus batas floating-point: random tepat di ujung atas.
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.999999999999);
    expect(weightedRandomIndex([1, 1, 1])).toBe(2);
    spy.mockRestore();
  });
});

/**
 * Angka inilah yang menentukan apakah log spin layak dipakai untuk evaluasi
 * off-policy nanti. Kalau salah, seluruh kesimpulan yang ditarik dari data
 * ini ikut salah, dan tidak ada cara memperbaikinya belakangan.
 */
describe("selectionPropensity", () => {
  it("mengembalikan proporsi bobot terhadap totalnya", () => {
    expect(selectionPropensity([1, 2, 3], 0)).toBeCloseTo(1 / 6);
    expect(selectionPropensity([1, 2, 3], 1)).toBeCloseTo(2 / 6);
    expect(selectionPropensity([1, 2, 3], 2)).toBeCloseTo(3 / 6);
  });

  it("selalu berjumlah satu untuk seluruh kandidat", () => {
    const weights = [7, 3, 11, 1];
    const total = weights
      .map((_, index) => selectionPropensity(weights, index))
      .reduce((sum, value) => sum + value, 0);

    expect(total).toBeCloseTo(1);
  });

  it("memberi 1 saat hanya ada satu kandidat", () => {
    expect(selectionPropensity([5], 0)).toBe(1);
  });

  it("mengembalikan 0 untuk indeks di luar rentang atau bobot tak terpakai", () => {
    expect(selectionPropensity([1, 2], -1)).toBe(0);
    expect(selectionPropensity([1, 2], 5)).toBe(0);
    expect(selectionPropensity([0, 0], 0)).toBe(0);
    expect(selectionPropensity([], 0)).toBe(0);
  });

  it("mencerminkan bias harga yang memang ada di kebijakan ini", () => {
    // Bukan undian seragam: dengan budget 20rb, tempat 5rb dapat bobot 15rb
    // dan tempat 15rb dapat bobot 5rb. Bias inilah yang wajib tercatat.
    const weights = calculateSpinWeights(
      [{ price_tier: 5000 }, { price_tier: 15000 }],
      20000,
    );

    expect(selectionPropensity(weights, 0)).toBeCloseTo(0.75);
    expect(selectionPropensity(weights, 1)).toBeCloseTo(0.25);
  });
});