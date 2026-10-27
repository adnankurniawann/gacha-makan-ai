/**
 * Evaluasi off-policy: apakah bandit lebih baik dari kebijakan sekarang?
 *
 *   npx tsx scripts/evaluate-bandit.ts --input=spins.csv --restaurants=restaurants.csv
 *   npx tsx scripts/evaluate-bandit.ts --input=ml/data/synthetic-spins.json \
 *       --restaurants=ml/data/synthetic-restaurants.json
 *
 * Log dibagi menurut waktu: model dilatih pada bagian awal (default 70%),
 * lalu dinilai dengan IPS/SNIPS pada sisanya — penayangan yang belum pernah
 * dilihatnya. Membagi secara acak akan membocorkan masa depan ke pelatihan.
 *
 * Ini juga shadow mode: model menilai setiap kandidat yang pernah tersedia,
 * tanpa satu pun hasilnya ditayangkan ke pengguna.
 *
 * Cara membaca hasilnya: bandingkan interval SNIPS bandit dengan accept rate
 * kebijakan pengumpul. Kalau intervalnya masih menyentuh angka itu, hasilnya
 * belum bisa dibedakan dari kebetulan — laporkan apa adanya.
 */

import { resolve } from "node:path";

import { evaluatePolicy, uniformPolicy, type CandidatePolicy } from "@/lib/ml/evaluation";
import { dot } from "@/lib/ml/linalg";
import { trainModel } from "@/lib/ml/model";
import { BANDIT_POLICY, thompsonProbabilities } from "@/lib/ml/policy";
import { buildTrainingSet, chronological } from "@/lib/ml/training";

import {
  arg,
  isSyntheticLog,
  loadCatalog,
  loadSpinRows,
  RESTAURANT_EXPORT_SQL,
  SPIN_EXPORT_SQL,
} from "./lib/spin-export";

function pct(value: number): string {
  return `${(100 * value).toFixed(1)}%`;
}

function main(): void {
  const input = arg("input");
  const restaurantsPath = arg("restaurants");
  if (!input || !restaurantsPath) {
    console.log("Butuh --input dan --restaurants. Kueri ekspornya:\n");
    console.log(`-- spins\n${SPIN_EXPORT_SQL}\n\n-- restaurants\n${RESTAURANT_EXPORT_SQL}`);
    process.exit(1);
  }

  const trainFraction = Number(arg("train") ?? 0.7);
  const rows = chronological(loadSpinRows(resolve(input)));
  const catalog = loadCatalog(resolve(restaurantsPath));

  const splitIndex = Math.floor(rows.length * trainFraction);
  const splitAt = rows[splitIndex]?.shown_at;
  if (!splitAt || splitIndex === 0) {
    throw new Error(`Terlalu sedikit baris (${rows.length}) untuk dibagi.`);
  }

  // Dilatih HANYA pada baris sebelum titik potong.
  const model = trainModel(buildTrainingSet(rows.slice(0, splitIndex)), { policy: BANDIT_POLICY });

  const thompson: CandidatePolicy = (xs, rng) => thompsonProbabilities(model, xs, rng);
  const greedy: CandidatePolicy = (xs) => {
    const scores = xs.map((x) => dot(model.theta, x));
    const best = scores.indexOf(Math.max(...scores));
    return xs.map((_, i) => (i === best ? 1 : 0));
  };

  const options = { evaluateFrom: splitAt, bootstrapSamples: 1000 };
  const results = [
    ["Thompson (ε=0,1)", evaluatePolicy(rows, catalog, thompson, options)],
    ["Greedy θ̂", evaluatePolicy(rows, catalog, greedy, options)],
    ["Uniform random", evaluatePolicy(rows, catalog, uniformPolicy, options)],
  ] as const;

  const reference = results[0][1];
  console.log(isSyntheticLog(rows) ? "\n*** DATA SINTETIS — bukan bukti apa pun tentang manusia ***" : "");
  console.log(`\nDilatih pada ${splitIndex} baris pertama, dinilai pada ${reference.n} baris sesudah ${splitAt}.`);
  if (Object.keys(reference.skipped).length > 0) {
    console.log("Dilewati:", reference.skipped);
  }
  console.log(`Kebijakan pengumpul (yang benar-benar tayang): accept ${pct(reference.loggedAcceptRate)}\n`);

  console.log("| Kebijakan | SNIPS | 95% CI | IPS | ESS |");
  console.log("|---|---|---|---|---|");
  for (const [name, r] of results) {
    console.log(
      `| ${name} | ${pct(r.snips)} | ${pct(r.snipsCi[0])}–${pct(r.snipsCi[1])} | ${pct(r.ips)} | ${r.effectiveSampleSize.toFixed(0)} |`,
    );
  }

  const [lo] = reference.snipsCi;
  console.log(
    lo > reference.loggedAcceptRate
      ? "\nBatas bawah interval Thompson di atas kebijakan sekarang."
      : "\nInterval Thompson masih menyentuh kebijakan sekarang — belum bisa dibedakan dari kebetulan.",
  );
  if (reference.clipped > 0) {
    console.log(`${reference.clipped} baris berbobot di atas batas dan dipotong — cek baris dengan policy_score sangat kecil.`);
  }
  if (reference.effectiveSampleSize < reference.n / 10) {
    console.log("ESS kurang dari 10% n: hasilnya ditentukan segelintir baris berbobot besar.");
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
