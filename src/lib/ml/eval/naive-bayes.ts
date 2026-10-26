/**
 * Pengklasifikasi Naive Bayes multinomial atas n-gram huruf dari nama.
 *
 * Pembanding tanpa LLM yang dilatih dari data, bukan aturan tangan. Kalau
 * model 100 baris yang dilatih dalam sedetik ini menyamai LLM, LLM-nya tidak
 * sebanding dengan biayanya — dan itu pertanyaan yang harus bisa dijawab
 * sebelum memakai LLM di produksi.
 *
 * Kenapa n-gram huruf, bukan kata: nama warung penuh variasi ejaan dan
 * gabungan ("Geprek", "Gepuk", "AyamGeprek", "Bakso", "Baso"). Potongan 2–4
 * huruf tetap cocok walau katanya tidak persis sama.
 */

import { CUISINE_SLOTS, type CuisineSlot } from "@/lib/ml/taxonomy";
import { normalizeEvalName } from "@/lib/ml/eval/dataset";

/** Fitur: n-gram huruf 2–4 dari nama berbatas spasi, ditambah token kata utuh. */
export function nameFeatures(name: string): string[] {
  const text = ` ${normalizeEvalName(name)} `;
  const features: string[] = [];
  for (let n = 2; n <= 4; n += 1) {
    for (let i = 0; i + n <= text.length; i += 1) features.push(text.slice(i, i + n));
  }
  for (const word of text.trim().split(" ")) if (word) features.push(`w:${word}`);
  return features;
}

export interface NaiveBayesModel {
  alpha: number;
  classes: CuisineSlot[];
  logPrior: Map<CuisineSlot, number>;
  counts: Map<CuisineSlot, Map<string, number>>;
  totals: Map<CuisineSlot, number>;
  vocabularySize: number;
}

export function trainNaiveBayes(
  examples: Array<{ name: string; gold: CuisineSlot }>,
  alpha = 1,
): NaiveBayesModel {
  const counts = new Map<CuisineSlot, Map<string, number>>();
  const totals = new Map<CuisineSlot, number>();
  const docs = new Map<CuisineSlot, number>();
  const vocabulary = new Set<string>();

  for (const { name, gold } of examples) {
    docs.set(gold, (docs.get(gold) ?? 0) + 1);
    let classCounts = counts.get(gold);
    if (!classCounts) counts.set(gold, (classCounts = new Map()));
    for (const feature of nameFeatures(name)) {
      classCounts.set(feature, (classCounts.get(feature) ?? 0) + 1);
      totals.set(gold, (totals.get(gold) ?? 0) + 1);
      vocabulary.add(feature);
    }
  }

  const classes = CUISINE_SLOTS.filter((slot) => docs.has(slot));
  const logPrior = new Map(
    classes.map((slot) => [slot, Math.log(docs.get(slot)! / examples.length)] as const),
  );

  return { alpha, classes, logPrior, counts, totals, vocabularySize: vocabulary.size };
}

/** Peluang posterior tiap slot, dijumlah 1. */
export function predictProba(model: NaiveBayesModel, name: string): Map<CuisineSlot, number> {
  const features = nameFeatures(name);
  const scores = model.classes.map((slot) => {
    const classCounts = model.counts.get(slot)!;
    const denominator = Math.log(model.totals.get(slot)! + model.alpha * model.vocabularySize);
    let score = model.logPrior.get(slot)!;
    for (const feature of features) {
      score += Math.log((classCounts.get(feature) ?? 0) + model.alpha) - denominator;
    }
    return score;
  });

  // Softmax dengan pengurangan maksimum supaya exp tidak underflow.
  const max = Math.max(...scores);
  const exps = scores.map((score) => Math.exp(score - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return new Map(model.classes.map((slot, i) => [slot, exps[i] / sum] as const));
}

export function predictNaiveBayes(
  model: NaiveBayesModel,
  name: string,
): { slot: CuisineSlot; probability: number } {
  let best: { slot: CuisineSlot; probability: number } = { slot: "lainnya", probability: 0 };
  for (const [slot, probability] of predictProba(model, name)) {
    if (probability > best.probability) best = { slot, probability };
  }
  return best;
}
