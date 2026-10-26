import { describe, expect, it } from "vitest";

import {
  BayesianLinearModel,
  epsilonGreedyPolicy,
  linUcbPolicy,
  nearestPolicy,
  oraclePolicy,
  thompsonSamplingPolicy,
  uniformRandomPolicy,
} from "@/lib/ml/bandit";
import { createRng, dot } from "@/lib/ml/linalg";

describe("BayesianLinearModel", () => {
  it("mulai dari θ nol", () => {
    const model = new BayesianLinearModel(3);
    expect(model.theta()).toEqual([0, 0, 0]);
  });

  it("bergerak ke arah fitur yang menghasilkan reward", () => {
    const model = new BayesianLinearModel(2);
    for (let i = 0; i < 20; i += 1) model.update([1, 0], 1);

    const theta = model.theta();
    expect(theta[0]).toBeGreaterThan(0.5);
    expect(theta[1]).toBe(0);
  });

  it("bergerak menjauh dari fitur yang tidak pernah berhasil", () => {
    const model = new BayesianLinearModel(2);
    for (let i = 0; i < 20; i += 1) {
      model.update([1, 0], 1);
      model.update([0, 1], 0);
    }

    const theta = model.theta();
    expect(theta[0]).toBeGreaterThan(theta[1]);
  });

  it("memulihkan θ yang sebenarnya dari data yang bersih", () => {
    // Uji paling menentukan: kalau aljabarnya salah, ini gagal walau semua
    // tes lain lulus.
    const trueTheta = [1.5, -0.8, 0.4];
    const model = new BayesianLinearModel(3, 0.01);
    const rng = createRng(3);

    for (let i = 0; i < 4000; i += 1) {
      const x = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1];
      model.update(x, dot(trueTheta, x));
    }

    const theta = model.theta();
    for (let i = 0; i < 3; i += 1) {
      expect(theta[i]).toBeCloseTo(trueTheta[i], 1);
    }
  });

  it("variansnya menyusut untuk arah yang sering diamati", () => {
    // Inilah sumber eksplorasi: yang jarang dilihat tetap punya varians besar.
    const model = new BayesianLinearModel(2);
    const before = model.variance([1, 0]);

    for (let i = 0; i < 50; i += 1) model.update([1, 0], 1);

    expect(model.variance([1, 0])).toBeLessThan(before);
    expect(model.variance([0, 1])).toBeCloseTo(before, 10);
  });

  it("menghasilkan sampel posterior yang berbeda-beda tapi terhingga", () => {
    const model = new BayesianLinearModel(4);
    const rng = createRng(21);

    const first = model.sampleTheta(rng);
    const second = model.sampleTheta(rng);

    expect(first).not.toEqual(second);
    expect(first.every(Number.isFinite)).toBe(true);
  });

  it("sampelnya makin rapat setelah banyak observasi", () => {
    const rng = createRng(31);
    const fresh = new BayesianLinearModel(2);
    const trained = new BayesianLinearModel(2);
    for (let i = 0; i < 300; i += 1) trained.update([1, 0], 1);

    const spread = (model: BayesianLinearModel) => {
      const samples = Array.from({ length: 300 }, () => model.sampleTheta(rng)[0]);
      const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
      return Math.sqrt(
        samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / samples.length,
      );
    };

    expect(spread(trained)).toBeLessThan(spread(fresh));
  });
});

describe("kebijakan", () => {
  const candidates = [
    [1, 0.2, 1],
    [0, 0.9, 1],
    [0, 0.5, 1],
  ];

  it("uniform random memilih di dalam rentang dan menyentuh semua kandidat", () => {
    const policy = uniformRandomPolicy(5);
    const seen = new Set<number>();

    for (let i = 0; i < 200; i += 1) {
      const index = policy.select(candidates);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(candidates.length);
      seen.add(index);
    }

    expect(seen.size).toBe(3);
  });

  it("jarak terdekat selalu memilih fitur jarak tertinggi", () => {
    // Indeks 1 adalah 1/(1+km), yang membesar saat makin dekat.
    expect(nearestPolicy(1).select(candidates)).toBe(1);
  });

  it("epsilon-greedy mengeksploitasi apa yang sudah dipelajarinya", () => {
    const policy = epsilonGreedyPolicy(3, 9, 0);
    for (let i = 0; i < 50; i += 1) policy.update(candidates[0], 1);

    expect(policy.select(candidates)).toBe(0);
  });

  it("epsilon-greedy tetap menembak acak sesekali", () => {
    const policy = epsilonGreedyPolicy(3, 9, 1);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i += 1) seen.add(policy.select(candidates));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("LinUCB memberi bonus pada arah yang belum banyak diamati", () => {
    const optimistic = linUcbPolicy(3, 5);
    const greedy = linUcbPolicy(3, 0);

    for (const policy of [optimistic, greedy]) {
      for (let i = 0; i < 30; i += 1) policy.update(candidates[0], 1);
    }

    // Yang serakah bertahan di kandidat yang sudah terbukti; yang optimis
    // masih tertarik pada arah yang variansnya besar.
    expect(greedy.select(candidates)).toBe(0);
    expect(optimistic.select(candidates)).not.toBe(0);
  });

  it("Thompson menemukan kandidat terbaik setelah cukup banyak observasi", () => {
    const policy = thompsonSamplingPolicy(3, 17);

    for (let round = 0; round < 400; round += 1) {
      const index = policy.select(candidates);
      // Hanya kandidat pertama yang menghasilkan reward.
      policy.update(candidates[index], index === 0 ? 1 : 0);
    }

    let hits = 0;
    for (let i = 0; i < 100; i += 1) {
      if (policy.select(candidates) === 0) hits += 1;
    }
    expect(hits).toBeGreaterThan(70);
  });

  it("oracle memilih menurut θ yang sebenarnya", () => {
    expect(oraclePolicy([0, 1, 0]).select(candidates)).toBe(1);
    expect(oraclePolicy([1, 0, 0]).select(candidates)).toBe(0);
  });

  it("semua kebijakan berulang persis untuk benih yang sama", () => {
    const run = () => {
      const policy = thompsonSamplingPolicy(3, 77);
      return Array.from({ length: 20 }, () => {
        const index = policy.select(candidates);
        policy.update(candidates[index], index === 0 ? 1 : 0);
        return index;
      });
    };

    expect(run()).toEqual(run());
  });
});
