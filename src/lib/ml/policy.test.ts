import { describe, expect, it } from "vitest";

import { FEATURE_DIM } from "@/lib/ml/features";
import { createRng } from "@/lib/ml/linalg";
import {
  decideThompson,
  drawIndex,
  inRollout,
  thompsonProbabilities,
} from "@/lib/ml/policy";

function oneHot(index: number): number[] {
  const x = new Array<number>(FEATURE_DIM).fill(0);
  x[index] = 1;
  return x;
}

function diagonal(scale: number): number[][] {
  return Array.from({ length: FEATURE_DIM }, (_, i) =>
    Array.from({ length: FEATURE_DIM }, (_, j) => (i === j ? scale : 0)),
  );
}

/** θ̂ yang jelas lebih suka dimensi 0, dengan ketidakpastian yang bisa diatur. */
function artifact(uncertainty: number) {
  const theta = new Array<number>(FEATURE_DIM).fill(0);
  theta[0] = 1;
  return { theta, cholesky: diagonal(uncertainty) };
}

const candidates = [oneHot(0), oneHot(1), oneHot(2)];

describe("thompsonProbabilities", () => {
  it("berjumlah 1 dan tidak pernah di bawah ε/n", () => {
    const probs = thompsonProbabilities(artifact(0.5), candidates, createRng(1), {
      epsilon: 0.1,
    });
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    for (const p of probs) expect(p).toBeGreaterThanOrEqual(0.1 / 3 - 1e-12);
  });

  it("posterior yang yakin hampir selalu memilih yang terbaik", () => {
    const probs = thompsonProbabilities(artifact(1e-6), candidates, createRng(2), {
      epsilon: 0.1,
    });
    expect(probs[0]).toBeCloseTo(0.9 + 0.1 / 3, 6);
  });

  it("posterior yang ragu menyebar peluangnya", () => {
    const probs = thompsonProbabilities(artifact(5), candidates, createRng(3), {
      epsilon: 0,
      samples: 2000,
    });
    expect(probs[0]).toBeGreaterThan(probs[1]);
    expect(probs[1]).toBeGreaterThan(0.15);
  });

  it("satu kandidat berarti peluang 1", () => {
    expect(thompsonProbabilities(artifact(1), [oneHot(0)], createRng(4))).toEqual([1]);
  });
});

describe("drawIndex", () => {
  it("frekuensi undian mengikuti peluangnya", () => {
    const rng = createRng(5);
    const counts = [0, 0, 0];
    for (let i = 0; i < 20_000; i += 1) counts[drawIndex([0.2, 0.5, 0.3], rng)] += 1;
    expect(counts[0] / 20_000).toBeCloseTo(0.2, 1);
    expect(counts[1] / 20_000).toBeCloseTo(0.5, 1);
  });
});

describe("decideThompson", () => {
  it("propensity yang dicatat sama dengan peluang indeks yang terundi", () => {
    // Propensity ini masuk ke policy_score. Kalau tidak cocok dengan
    // pengundian sebenarnya, evaluasi IPS berikutnya bias tanpa ketahuan.
    const decision = decideThompson(artifact(1e-6), candidates, createRng(6), {
      epsilon: 0.3,
    });
    const expected = decision.index === 0 ? 0.7 + 0.1 : 0.1;
    expect(decision.propensity).toBeCloseTo(expected, 6);
  });

  it("menolak kandidat kosong", () => {
    expect(() => decideThompson(artifact(1), [], createRng(7))).toThrow();
  });
});

describe("inRollout", () => {
  it("deterministik per kunci", () => {
    expect(inRollout("user-a", 0.5)).toBe(inRollout("user-a", 0.5));
  });

  it("0 tidak pernah, 1 selalu", () => {
    expect(inRollout("x", 0)).toBe(false);
    expect(inRollout("x", 1)).toBe(true);
    expect(inRollout("x", Number.NaN)).toBe(false);
  });

  it("porsinya mendekati fraksi yang diminta", () => {
    let inside = 0;
    for (let i = 0; i < 10_000; i += 1) if (inRollout(`user-${i}`, 0.2)) inside += 1;
    expect(inside / 10_000).toBeGreaterThan(0.17);
    expect(inside / 10_000).toBeLessThan(0.23);
  });
});
