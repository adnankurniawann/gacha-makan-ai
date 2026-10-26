import { describe, expect, it } from "vitest";

import { evaluatePolicy, uniformPolicy, type CandidatePolicy } from "@/lib/ml/evaluation";
import { createRng } from "@/lib/ml/linalg";
import type { RawSpinRow } from "@/lib/ml/training";

/**
 * Dunia kecil dengan jawaban yang diketahui:
 * - warung A dekat (100 m), diterima dengan peluang 0,8
 * - warung B jauh (3 km), diterima dengan peluang 0,2
 * - kebijakan lama memilih A hanya 25% — sengaja bias, seperti bobot harga
 */
function biasedLog(n: number, seed = 11): RawSpinRow[] {
  const rng = createRng(seed);
  const rows: RawSpinRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const pickA = rng() < 0.25;
    const accepted = rng() < (pickA ? 0.8 : 0.2);
    rows.push({
      id: `e${String(i).padStart(5, "0")}`,
      user_id: `u${i % 30}`,
      restaurant_id: pickA ? "A" : "B",
      shown_at: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
      category: "Restaurant",
      price_tier: 15000,
      distance_km: pickA ? 0.1 : 3,
      hour_local: 12,
      day_of_week: 2,
      is_raining: null,
      effective_action: accepted ? "accepted" : "respun",
      policy_score: pickA ? 0.25 : 0.75,
      policy: "weighted_budget_v1",
      candidate_ids: ["A", "B"],
      candidate_distances_m: [100, 3000],
    });
  }
  return rows;
}

const catalog = new Map([
  ["A", { category: "Restaurant", price_tier: 15000 }],
  ["B", { category: "Restaurant", price_tier: 15000 }],
]);

/** Selalu memilih yang terdekat — fitur 1 adalah 1/(1+km). */
const nearest: CandidatePolicy = (xs) => {
  const best = xs[0][1] >= xs[1][1] ? 0 : 1;
  return xs.map((_, i) => (i === best ? 1 : 0));
};

describe("evaluatePolicy", () => {
  it("mengoreksi bias kebijakan pengumpul", () => {
    const result = evaluatePolicy(biasedLog(6000), catalog, nearest, { bootstrapSamples: 200 });

    // Accept rate yang tercatat ≈ 0,25·0,8 + 0,75·0,2 = 0,35, jauh dari 0,8.
    expect(result.loggedAcceptRate).toBeLessThan(0.4);
    // Nilai sebenarnya kebijakan "selalu A" adalah 0,8.
    expect(result.snips).toBeGreaterThan(0.76);
    expect(result.snips).toBeLessThan(0.84);
    expect(result.ips).toBeGreaterThan(0.74);
    expect(result.ips).toBeLessThan(0.86);
    expect(result.snipsCi[0]).toBeLessThan(result.snips);
    expect(result.snipsCi[1]).toBeGreaterThan(result.snips);
  });

  it("kebijakan seragam bernilai rata-rata kedua warung", () => {
    const result = evaluatePolicy(biasedLog(6000), catalog, uniformPolicy, {
      bootstrapSamples: 50,
    });
    expect(result.snips).toBeGreaterThan(0.45);
    expect(result.snips).toBeLessThan(0.55);
  });

  it("melaporkan baris yang dilewati, bukan menelannya diam-diam", () => {
    const rows = biasedLog(10);
    rows[0] = { ...rows[0], candidate_ids: null };
    rows[1] = { ...rows[1], policy_score: null };
    rows[2] = { ...rows[2], effective_action: null };
    rows[3] = { ...rows[3], candidate_ids: ["X", "Y"] };

    const result = evaluatePolicy(rows, catalog, uniformPolicy, { bootstrapSamples: 10 });
    expect(result.n).toBe(6);
    expect(result.skipped).toEqual({
      "tanpa arm set": 1,
      "tanpa policy_score": 1,
      "belum berlabel": 1,
      "restoran terpilih tidak ada di arm set": 1,
    });
  });

  it("evaluateFrom hanya menilai baris sesudahnya", () => {
    const rows = biasedLog(100);
    const result = evaluatePolicy(rows, catalog, uniformPolicy, {
      evaluateFrom: rows[60].shown_at,
      bootstrapSamples: 10,
    });
    expect(result.n).toBe(40);
  });

  it("fitur kandidat tidak melihat hasil penayangannya sendiri", () => {
    // Satu-satunya baris: A diterima. Kalau hasilnya bocor ke fitur
    // popularitas (indeks 23..24), nilainya bukan nol.
    const seen: number[][][] = [];
    const spy: CandidatePolicy = (xs) => {
      seen.push(xs);
      return uniformPolicy(xs, () => 0);
    };
    const [row] = biasedLog(1);
    evaluatePolicy([{ ...row, effective_action: "accepted" }], catalog, spy, {
      bootstrapSamples: 1,
    });
    expect(seen[0][0][23]).toBe(0);
    expect(seen[0][0][24]).toBe(0);
  });
});
