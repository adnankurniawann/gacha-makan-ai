/**
 * Metrik evaluasi klasifikasi kategori.
 *
 * Akurasi saja menyesatkan di sini: distribusi slotnya timpang, jadi model yang
 * selalu menjawab `nusantara` sudah dapat akurasi lumayan. Angka utamanya
 * macro-F1 (tiap slot berbobot sama), dan yang paling dekat dengan cara hasil
 * ini dipakai adalah presisi pada saran yang *akan ditulis* ke database.
 */

import { createRng } from "@/lib/ml/linalg";
import { CUISINE_SLOTS, type CuisineSlot } from "@/lib/ml/taxonomy";
import type { Confidence } from "@/lib/ml/categorize";

export interface Prediction {
  id: string;
  /** `null` kalau tidak ada jawaban sah (JSON rusak, id hilang, ditolak). */
  slot: CuisineSlot | null;
  confidence: Confidence | null;
}

export interface Labeled {
  id: string;
  gold: CuisineSlot;
}

export interface ClassScore {
  slot: CuisineSlot;
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface Scores {
  n: number;
  accuracy: number;
  macroF1: number;
  perClass: ClassScore[];
  /** confusion[gold][pred], plus kolom `tanpa_jawaban`. */
  confusion: Record<CuisineSlot, Record<CuisineSlot | "tanpa_jawaban", number>>;
  /** Porsi yang tidak mendapat jawaban sah. */
  failureRate: number;
}

function pair(gold: Labeled[], predictions: Prediction[]): Array<[CuisineSlot, Prediction]> {
  const byId = new Map(predictions.map((p) => [p.id, p]));
  return gold.map((item) => [
    item.gold,
    byId.get(item.id) ?? { id: item.id, slot: null, confidence: null },
  ]);
}

const f1Of = (p: number, r: number) => (p + r > 0 ? (2 * p * r) / (p + r) : 0);

/**
 * Skor lengkap. Prediksi yang hilang dihitung salah — kegagalan model tidak
 * boleh membuat angkanya terlihat lebih bagus dengan mengecilkan penyebut.
 */
export function score(gold: Labeled[], predictions: Prediction[]): Scores {
  const pairs = pair(gold, predictions);

  const confusion = Object.fromEntries(
    CUISINE_SLOTS.map((g) => [
      g,
      Object.fromEntries([...CUISINE_SLOTS, "tanpa_jawaban"].map((p) => [p, 0])),
    ]),
  ) as Scores["confusion"];

  let correct = 0;
  let failures = 0;
  for (const [g, p] of pairs) {
    confusion[g][p.slot ?? "tanpa_jawaban"] += 1;
    if (p.slot === g) correct += 1;
    if (p.slot === null) failures += 1;
  }

  // Macro-F1 hanya atas slot yang ada di label emas; slot tanpa contoh tidak
  // punya recall yang bisa diukur.
  const perClass: ClassScore[] = [];
  for (const slot of CUISINE_SLOTS) {
    const support = CUISINE_SLOTS.reduce((sum, p) => sum + confusion[slot][p], 0) +
      confusion[slot].tanpa_jawaban;
    if (support === 0) continue;
    const tp = confusion[slot][slot];
    const predicted = CUISINE_SLOTS.reduce((sum, g) => sum + confusion[g][slot], 0);
    const precision = predicted > 0 ? tp / predicted : 0;
    const recall = tp / support;
    perClass.push({ slot, support, precision, recall, f1: f1Of(precision, recall) });
  }

  const n = pairs.length;
  return {
    n,
    accuracy: n > 0 ? correct / n : 0,
    macroF1: perClass.length > 0 ? perClass.reduce((s, c) => s + c.f1, 0) / perClass.length : 0,
    perClass,
    confusion,
    failureRate: n > 0 ? failures / n : 0,
  };
}

const RANK: Record<Confidence, number> = { tinggi: 2, sedang: 1, rendah: 0 };

/**
 * Titik operasi produksi: hanya saran yang bukan `lainnya` dan confidence-nya
 * ≥ ambang yang ditulis ke database (lihat `suggestionsToSql`).
 *
 * Presisi di sini lebih penting dari akurasi keseluruhan. Saran yang tidak
 * ditulis cuma membiarkan warung tetap di `lainnya`; saran salah yang ditulis
 * meracuni fitur model sebagai fakta.
 */
export function writeOperatingPoint(
  gold: Labeled[],
  predictions: Prediction[],
  minConfidence: Confidence = "sedang",
): { written: number; coverage: number; precision: number } {
  let written = 0;
  let correct = 0;
  const pairs = pair(gold, predictions);
  for (const [g, p] of pairs) {
    if (p.slot === null || p.slot === "lainnya" || p.confidence === null) continue;
    if (RANK[p.confidence] < RANK[minConfidence]) continue;
    written += 1;
    if (p.slot === g) correct += 1;
  }
  return {
    written,
    coverage: pairs.length > 0 ? written / pairs.length : 0,
    precision: written > 0 ? correct / written : 0,
  };
}

/** Interval 95% persentil dari bootstrap atas item. */
export function bootstrapInterval(
  gold: Labeled[],
  predictions: Prediction[],
  metric: (g: Labeled[], p: Prediction[]) => number,
  options: { resamples?: number; seed?: number } = {},
): [number, number] {
  const resamples = options.resamples ?? 1000;
  const rng = createRng(options.seed ?? 20261026);
  const values: number[] = [];
  const byId = new Map(predictions.map((x) => [x.id, x]));

  for (let r = 0; r < resamples; r += 1) {
    // Id dibuat unik per sampel supaya item yang terambil dua kali tetap
    // dihitung dua kali.
    const g: Labeled[] = [];
    const p: Prediction[] = [];
    for (let i = 0; i < gold.length; i += 1) {
      const item = gold[Math.floor(rng() * gold.length)];
      const key = `${item.id}#${i}`;
      g.push({ id: key, gold: item.gold });
      const pred = byId.get(item.id);
      if (pred) p.push({ ...pred, id: key });
    }
    values.push(metric(g, p));
  }

  values.sort((a, b) => a - b);
  return [values[Math.floor(0.025 * resamples)], values[Math.ceil(0.975 * resamples) - 1]];
}

/**
 * Uji McNemar eksak untuk dua model pada item yang sama.
 *
 * Hanya item tempat keduanya berbeda yang membawa informasi: `b` = A benar
 * B salah, `c` = sebaliknya. Di bawah H0 (kedua model sama baiknya) `b`
 * berdistribusi Binomial(b+c, ½). Lebih tepat daripada membandingkan dua
 * interval akurasi, karena kesalahan kedua model pada item yang sama saling
 * berkorelasi.
 */
export function mcnemar(
  gold: Labeled[],
  a: Prediction[],
  b: Prediction[],
): { aOnly: number; bOnly: number; pValue: number } {
  const pa = new Map(a.map((p) => [p.id, p.slot]));
  const pb = new Map(b.map((p) => [p.id, p.slot]));
  let aOnly = 0;
  let bOnly = 0;
  for (const item of gold) {
    const ca = pa.get(item.id) === item.gold;
    const cb = pb.get(item.id) === item.gold;
    if (ca && !cb) aOnly += 1;
    if (cb && !ca) bOnly += 1;
  }

  const n = aOnly + bOnly;
  if (n === 0) return { aOnly, bOnly, pValue: 1 };

  // P(X ≤ k) untuk Binomial(n, ½), dihitung di ruang log supaya n besar aman.
  const k = Math.min(aOnly, bOnly);
  let logTerm = -n * Math.LN2; // C(n,0)·2⁻ⁿ
  let tail = Math.exp(logTerm);
  for (let i = 1; i <= k; i += 1) {
    logTerm += Math.log(n - i + 1) - Math.log(i);
    tail += Math.exp(logTerm);
  }
  return { aOnly, bOnly, pValue: Math.min(1, 2 * tail) };
}
