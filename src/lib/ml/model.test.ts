import { describe, expect, it } from "vitest";

import { FEATURE_DIM, FEATURE_NAMES } from "@/lib/ml/features";
import { createRng } from "@/lib/ml/linalg";
import {
  loadModel,
  MODEL_FORMAT_VERSION,
  ModelLoadError,
  parseModelArtifact,
  trainModel,
} from "@/lib/ml/model";
import type { TrainingExample } from "@/lib/ml/training";

function example(x: number[], reward: number, id = "e"): TrainingExample {
  return {
    eventId: id,
    x,
    reward,
    shownAt: "2026-08-01T05:00:00Z",
    restaurantId: "r",
    userId: "u",
    policyScore: 0.2,
    policy: "weighted_budget_v1",
  };
}

/** Vektor dengan satu dimensi bernilai 1 dan bias di ujungnya. */
function oneHot(index: number): number[] {
  const x = new Array<number>(FEATURE_DIM).fill(0);
  x[index] = 1;
  x[FEATURE_DIM - 1] = 1;
  return x;
}

function trainedOnFirstDimension() {
  const examples: TrainingExample[] = [];
  for (let i = 0; i < 200; i += 1) {
    examples.push(example(oneHot(0), 1, `a${i}`));
    examples.push(example(oneHot(1), 0, `b${i}`));
  }
  return trainModel(examples);
}

describe("trainModel", () => {
  it("menghasilkan artefak yang lengkap", () => {
    const artifact = trainModel([example(oneHot(0), 1)]);

    expect(artifact.formatVersion).toBe(MODEL_FORMAT_VERSION);
    expect(artifact.featureDim).toBe(FEATURE_DIM);
    expect(artifact.featureNames).toEqual([...FEATURE_NAMES]);
    expect(artifact.theta).toHaveLength(FEATURE_DIM);
    expect(artifact.cholesky).toHaveLength(FEATURE_DIM);
    expect(artifact.examples).toBe(1);
  });

  it("belajar arah yang menghasilkan reward", () => {
    const artifact = trainedOnFirstDimension();
    expect(artifact.theta[0]).toBeGreaterThan(artifact.theta[1]);
  });

  it("bisa dilatih dari nol contoh", () => {
    // Model prior murni. Bukan error — ia hanya belum tahu apa-apa.
    const artifact = trainModel([]);
    expect(artifact.theta.every((value) => value === 0)).toBe(true);
    expect(artifact.examples).toBe(0);
  });

  it("menolak contoh dengan dimensi yang salah", () => {
    expect(() => trainModel([example([1, 2, 3], 1, "pendek")])).toThrow(
      /dimensi/,
    );
  });

  it("menghasilkan artefak yang bisa dibulak-balik lewat JSON", () => {
    // Artefaknya akan disimpan sebagai berkas JSON, jadi ia harus selamat
    // melewati serialisasi tanpa kehilangan apa pun.
    const artifact = trainedOnFirstDimension();
    const roundTripped = JSON.parse(JSON.stringify(artifact));

    expect(parseModelArtifact(roundTripped)).toEqual(artifact);
  });
});

describe("parseModelArtifact", () => {
  it("menerima artefak yang sah", () => {
    const artifact = trainedOnFirstDimension();
    expect(parseModelArtifact(artifact)).toBe(artifact);
  });

  it("menolak susunan fitur yang tidak cocok", () => {
    // Pemeriksaan terpenting: satu blok fitur yang disisipkan di tengah
    // menggeser seluruh bobot, dan modelnya akan tetap "jalan" sambil
    // menghasilkan rekomendasi yang omong kosong.
    const artifact = trainedOnFirstDimension();
    const tampered = {
      ...artifact,
      featureNames: [...artifact.featureNames].reverse(),
    };

    expect(() => parseModelArtifact(tampered)).toThrow(ModelLoadError);
    expect(() => parseModelArtifact(tampered)).toThrow(/susunan fitur/i);
  });

  it("menolak versi format yang tidak dikenal", () => {
    const artifact = { ...trainedOnFirstDimension(), formatVersion: 99 };
    expect(() => parseModelArtifact(artifact)).toThrow(/versi format/i);
  });

  it("menolak dimensi yang berbeda", () => {
    const artifact = { ...trainedOnFirstDimension(), featureDim: 12 };
    expect(() => parseModelArtifact(artifact)).toThrow(/dimensi/i);
  });

  it("menolak theta yang cacat", () => {
    const base = trainedOnFirstDimension();

    expect(() => parseModelArtifact({ ...base, theta: [1, 2] })).toThrow(/theta/i);
    expect(() =>
      parseModelArtifact({
        ...base,
        theta: base.theta.map((_, i) => (i === 0 ? Number.NaN : 0)),
      }),
    ).toThrow(/tak terhingga/i);
  });

  it("menolak matriks Cholesky yang cacat", () => {
    const base = trainedOnFirstDimension();
    expect(() => parseModelArtifact({ ...base, cholesky: [[1]] })).toThrow(
      /cholesky/i,
    );
  });

  it.each([null, undefined, 42, "model"])("menolak %s", (raw) => {
    expect(() => parseModelArtifact(raw)).toThrow(ModelLoadError);
  });
});

describe("loadModel", () => {
  const candidates = [oneHot(0), oneHot(1), oneHot(2)];

  it("memberi skor lebih tinggi ke arah yang terbukti", () => {
    const model = loadModel(trainedOnFirstDimension());
    const scores = model.scoreGreedy(candidates);

    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[0]).toBeGreaterThan(scores[2]);
  });

  it("memilih kandidat terbaik pada sebagian besar tarikan", () => {
    const model = loadModel(trainedOnFirstDimension());
    const rng = createRng(2026);

    let hits = 0;
    for (let i = 0; i < 500; i += 1) {
      if (model.select(candidates, rng) === 0) hits += 1;
    }

    // Bukan 100%: eksplorasi memang bagian dari rancangannya.
    expect(hits).toBeGreaterThan(350);
    expect(hits).toBeLessThan(500);
  });

  it("masih mengeksplorasi, tidak terkunci di satu pilihan", () => {
    const model = loadModel(trainedOnFirstDimension());
    const rng = createRng(7);

    const seen = new Set<number>();
    for (let i = 0; i < 300; i += 1) seen.add(model.select(candidates, rng));

    expect(seen.size).toBeGreaterThan(1);
  });

  it("berulang persis untuk benih yang sama", () => {
    const model = loadModel(trainedOnFirstDimension());

    const run = () => {
      const rng = createRng(99);
      return Array.from({ length: 20 }, () => model.select(candidates, rng));
    };

    expect(run()).toEqual(run());
  });

  it("menolak dipanggil tanpa kandidat", () => {
    const model = loadModel(trainedOnFirstDimension());
    expect(() => model.select([], createRng(1))).toThrow(/tidak ada kandidat/i);
  });

  it("memilih di bawah satu milidetik untuk 20 kandidat", () => {
    // Klaim arsitekturnya: model yang cukup sederhana untuk disajikan di dalam
    // route handler yang sudah ada, tanpa layanan inferensi terpisah.
    const model = loadModel(trainedOnFirstDimension());
    const rng = createRng(5);
    const many = Array.from({ length: 20 }, (_, i) => oneHot(i % FEATURE_DIM));

    // Dipanaskan dulu supaya yang terukur bukan kompilasi JIT-nya.
    for (let i = 0; i < 100; i += 1) model.select(many, rng);

    const started = performance.now();
    const iterations = 1000;
    for (let i = 0; i < iterations; i += 1) model.select(many, rng);
    const perCall = (performance.now() - started) / iterations;

    expect(perCall).toBeLessThan(1);
  });
});
