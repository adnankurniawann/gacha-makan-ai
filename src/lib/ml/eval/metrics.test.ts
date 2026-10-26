import { describe, expect, it } from "vitest";

import {
  bootstrapInterval,
  mcnemar,
  score,
  writeOperatingPoint,
  type Labeled,
  type Prediction,
} from "@/lib/ml/eval/metrics";
import { nameFeatures, predictNaiveBayes, trainNaiveBayes } from "@/lib/ml/eval/naive-bayes";

const gold: Labeled[] = [
  { id: "1", gold: "ayam" },
  { id: "2", gold: "ayam" },
  { id: "3", gold: "mie" },
  { id: "4", gold: "mie" },
];

const pred = (id: string, slot: Prediction["slot"], confidence: Prediction["confidence"] = "tinggi") =>
  ({ id, slot, confidence }) as Prediction;

describe("score", () => {
  it("menghitung akurasi, macro-F1, dan confusion", () => {
    const result = score(gold, [pred("1", "ayam"), pred("2", "mie"), pred("3", "mie"), pred("4", "mie")]);
    expect(result.accuracy).toBe(0.75);
    // ayam: P=1 R=0,5 F1=2/3; mie: P=2/3 R=1 F1=0,8
    expect(result.macroF1).toBeCloseTo((2 / 3 + 0.8) / 2);
    expect(result.confusion.ayam.mie).toBe(1);
    expect(result.perClass.map((c) => c.slot)).toEqual(["ayam", "mie"]);
  });

  it("prediksi yang hilang dihitung salah, bukan dibuang", () => {
    const result = score(gold, [pred("1", "ayam")]);
    expect(result.accuracy).toBe(0.25);
    expect(result.failureRate).toBe(0.75);
    expect(result.confusion.mie.tanpa_jawaban).toBe(2);
  });
});

describe("writeOperatingPoint", () => {
  it("hanya menghitung yang akan ditulis: bukan lainnya, confidence cukup", () => {
    const result = writeOperatingPoint(gold, [
      pred("1", "ayam", "tinggi"),
      pred("2", "mie", "sedang"),
      pred("3", "mie", "rendah"),
      pred("4", "lainnya", "tinggi"),
    ]);
    expect(result).toEqual({ written: 2, coverage: 0.5, precision: 0.5 });
  });
});

describe("bootstrapInterval", () => {
  it("mengapit nilai titiknya", () => {
    const many: Labeled[] = Array.from({ length: 200 }, (_, i) => ({ id: `${i}`, gold: "ayam" }));
    const preds = many.map((item, i) => pred(item.id, i % 4 === 0 ? "mie" : "ayam"));
    const [lo, hi] = bootstrapInterval(many, preds, (g, p) => score(g, p).accuracy, { resamples: 300 });
    expect(lo).toBeLessThan(0.75);
    expect(hi).toBeGreaterThan(0.75);
    expect(hi - lo).toBeLessThan(0.2);
  });
});

describe("mcnemar", () => {
  it("tidak ada perbedaan → p = 1", () => {
    const p = [pred("1", "ayam"), pred("2", "ayam"), pred("3", "mie"), pred("4", "mie")];
    expect(mcnemar(gold, p, p)).toEqual({ aOnly: 0, bOnly: 0, pValue: 1 });
  });

  it("cocok dengan binomial eksak", () => {
    // 10 item: A benar semua, B salah semua → b=10, c=0, p = 2·0,5¹⁰
    const g: Labeled[] = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, gold: "ayam" }));
    const a = g.map((x) => pred(x.id, "ayam"));
    const b = g.map((x) => pred(x.id, "mie"));
    const result = mcnemar(g, a, b);
    expect(result.aOnly).toBe(10);
    expect(result.pValue).toBeCloseTo(2 / 1024);
  });
});

describe("naive bayes", () => {
  it("n-gram huruf dan token kata", () => {
    const features = nameFeatures("Mie");
    expect(features).toContain(" m");
    expect(features).toContain("mie ");
    expect(features).toContain("w:mie");
  });

  it("belajar dari potongan nama, termasuk ejaan yang belum pernah dilihat", () => {
    const model = trainNaiveBayes([
      { name: "Ayam Geprek Bu Rum", gold: "ayam" },
      { name: "Geprek Bensu", gold: "ayam" },
      { name: "Ayam Penyet Ria", gold: "ayam" },
      { name: "Bakso Solo", gold: "mie" },
      { name: "Mie Ayam Pak Min", gold: "mie" },
      { name: "Bakso Malang Cak Toni", gold: "mie" },
    ]);
    expect(predictNaiveBayes(model, "AyamGeprek Mantap").slot).toBe("ayam");
    expect(predictNaiveBayes(model, "Baksonya Mas Joko").slot).toBe("mie");
    const { probability } = predictNaiveBayes(model, "Bakso Solo");
    expect(probability).toBeGreaterThan(0.5);
    expect(probability).toBeLessThanOrEqual(1);
  });
});
