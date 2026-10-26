/**
 * Evaluasi kategorisasi nama warung: baseline tanpa LLM vs beberapa LLM, di
 * test set yang sama dengan label dari OpenStreetMap.
 *
 *   npx tsx scripts/eval-categorize.ts                         # baseline saja + laporan
 *   npx tsx scripts/eval-categorize.ts --provider=ollama       # + qwen2.5:7b
 *   npx tsx scripts/eval-categorize.ts --provider=ollama --model=qwen2.5:3b
 *   npx tsx scripts/eval-categorize.ts --provider=gemini
 *   npx tsx scripts/eval-categorize.ts --provider=ollama --limit=20   # coba dulu
 *   npx tsx scripts/eval-categorize.ts --split=dev             # untuk mengutak-atik prompt
 *
 * Alur:
 *   1. ml/eval/osm-cuisine.json → dataset (label, dedup, split) lewat
 *      `buildDataset`.
 *   2. Baseline `keyword` (toCuisineSlot pada nama) dan `naive-bayes` (dilatih
 *      di train, alpha dipilih di dev) dinilai di seluruh split dan di subset
 *      berimbang.
 *   3. LLM hanya dinilai di subset berimbang (≤ --per-class item per slot),
 *      karena memanggil model untuk ribuan nama mahal dan lambat. Jawabannya
 *      di-cache per item di ml/eval/cache/, jadi run yang terputus tinggal
 *      dilanjutkan dan laporan bisa dibuat ulang tanpa biaya.
 *   4. Laporan untuk semua metode yang cache-nya lengkap ditulis ke
 *      ml/eval/results.md dan results.json.
 *
 * Prompt di-iterasi di split `dev`. Split `test` dipakai untuk angka akhir;
 * mengutak-atik prompt sambil melihat angka test berarti angkanya overfit.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SUGGESTION_SCHEMA,
  SYSTEM_PROMPT,
  type CategorizeInput,
  type Confidence,
} from "@/lib/ml/categorize";
import {
  buildDataset,
  sampleBalanced,
  type EvalItem,
  type OsmSnapshot,
  type Split,
} from "@/lib/ml/eval/dataset";
import {
  bootstrapInterval,
  mcnemar,
  score,
  writeOperatingPoint,
  type Prediction,
} from "@/lib/ml/eval/metrics";
import { predictNaiveBayes, trainNaiveBayes, type NaiveBayesModel } from "@/lib/ml/eval/naive-bayes";
import { CUISINE_SLOTS, toCuisineSlot, type CuisineSlot } from "@/lib/ml/taxonomy";

import { createProvider } from "./lib/llm-providers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVAL_DIR = resolve(ROOT, "ml/eval");
const CACHE_DIR = resolve(EVAL_DIR, "cache");
const SAMPLE_SEED = 20261026;

/**
 * Harga per 1 juta token (USD), dicek dari halaman harga resmi pada tanggal
 * yang tertulis. Model tanpa harga di sini dilaporkan tanpa biaya, bukan
 * dengan angka tebakan.
 */
const PRICES: Record<string, { input: number; output: number; checked: string; note?: string }> = {
  "gemini/gemini-3.5-flash-lite": { input: 0.3, output: 2.5, checked: "2026-10-26" },
  "gemini/gemini-3.8-flash": {
    input: 0.75,
    output: 3.75,
    checked: "2026-10-26",
    note: "naik ke $1,50/$7,50 mulai 1 Jan 2027",
  },
};

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * Sidik prompt + skema. Jawaban di cache yang dibuat dengan prompt lain tidak
 * dipakai: angka evaluasi harus berlaku untuk prompt yang sekarang.
 */
const PROMPT_HASH = createHash("sha256")
  .update(SYSTEM_PROMPT)
  .update(JSON.stringify(SUGGESTION_SCHEMA))
  .digest("hex")
  .slice(0, 12);

interface CacheEntry {
  id: string;
  /** Label provider, mis. "ollama/qwen2.5:7b". */
  label: string;
  promptHash: string;
  slot: CuisineSlot | null;
  confidence: Confidence | null;
  reason: string;
  /** Batch tempat item ini dikirim: waktu mulai, lama, dan ukurannya. */
  batchStartedAt: number;
  batchMs: number;
  batchSize: number;
  /** Bagian item ini dari token batch (dibagi rata). */
  inputTokens: number;
  outputTokens: number;
}

const cachePath = (label: string, split: Split) =>
  resolve(CACHE_DIR, `${label.replace(/[^a-z0-9.]+/gi, "_")}.${split}.jsonl`);

function readCache(path: string): Map<string, CacheEntry> {
  const entries = new Map<string, CacheEntry>();
  if (!existsSync(path)) return entries;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as CacheEntry;
    if (entry.promptHash === PROMPT_HASH) entries.set(entry.id, entry);
  }
  return entries;
}

async function runProvider(
  providerName: string,
  model: string | undefined,
  items: EvalItem[],
  split: Split,
): Promise<void> {
  const provider = createProvider(providerName, model);
  const batchSize = arg("batch") ? Number(arg("batch")) : provider.batchSize;
  const path = cachePath(provider.label, split);
  const cache = readCache(path);
  const retryFailed = flag("retry-failed");

  const missing = items.filter((item) => {
    const hit = cache.get(item.id);
    return !hit || (retryFailed && hit.slot === null);
  });
  const pending = missing.slice(0, arg("limit") ? Number(arg("limit")) : Infinity);

  console.log(
    `\n${provider.label}: ${items.length - missing.length}/${items.length} sudah di cache, ` +
      `${pending.length} dikirim (batch ${batchSize}, prompt ${PROMPT_HASH}).`,
  );
  mkdirSync(CACHE_DIR, { recursive: true });

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    // Sama dengan kondisi produksi: yang dikurasi adalah baris "Restaurant".
    const inputs: CategorizeInput[] = batch.map((item) => ({
      id: item.id,
      name: item.name,
      category: "Restaurant",
    }));

    const startedAt = Date.now();
    process.stdout.write(`  ${i + batch.length}/${pending.length} … `);
    const { result, usage } = await provider.categorize(inputs);
    const batchMs = Date.now() - startedAt;
    console.log(`${(batchMs / 1000).toFixed(1)} detik`);

    const bySuggestion = new Map(result.suggestions.map((s) => [s.id, s]));
    const lines = batch.map((item) => {
      const suggestion = bySuggestion.get(item.id);
      const entry: CacheEntry = {
        id: item.id,
        label: provider.label,
        promptHash: PROMPT_HASH,
        slot: suggestion?.slot ?? null,
        confidence: suggestion?.confidence ?? null,
        reason: suggestion?.reason ?? "",
        batchStartedAt: startedAt,
        batchMs,
        batchSize: batch.length,
        inputTokens: usage.input / batch.length,
        outputTokens: usage.output / batch.length,
      };
      return JSON.stringify(entry);
    });
    appendFileSync(path, `${lines.join("\n")}\n`);
  }
}

// ---------------------------------------------------------------------------
// Metode tanpa LLM
// ---------------------------------------------------------------------------

function keywordPredictions(items: EvalItem[]): Prediction[] {
  return items.map((item) => {
    const slot = toCuisineSlot(item.name);
    // Aturan kata kunci tidak punya tingkat keyakinan: cocok atau tidak.
    return { id: item.id, slot, confidence: slot === "lainnya" ? "rendah" : "tinggi" };
  });
}

/** Ambang peluang NB → tingkat confidence, supaya titik operasinya sebanding. */
function nbConfidence(probability: number): Confidence {
  if (probability >= 0.9) return "tinggi";
  if (probability >= 0.7) return "sedang";
  return "rendah";
}

function nbPredictions(model: NaiveBayesModel, items: EvalItem[]): Prediction[] {
  return items.map((item) => {
    const { slot, probability } = predictNaiveBayes(model, item.name);
    return { id: item.id, slot, confidence: nbConfidence(probability) };
  });
}

/** Alpha dipilih dari macro-F1 di dev — test tidak disentuh saat memilih. */
function trainTunedNaiveBayes(items: EvalItem[]): NaiveBayesModel {
  const train = items.filter((item) => item.split === "train");
  const dev = items.filter((item) => item.split === "dev");
  let best: { model: NaiveBayesModel; f1: number } | null = null;
  for (const alpha of [0.03, 0.1, 0.3, 1]) {
    const model = trainNaiveBayes(train, alpha);
    const f1 = score(dev, nbPredictions(model, dev)).macroF1;
    if (!best || f1 > best.f1) best = { model, f1 };
  }
  return best!.model;
}

// ---------------------------------------------------------------------------
// Laporan
// ---------------------------------------------------------------------------

interface MethodRun {
  label: string;
  predictions: Prediction[];
  /** Hanya untuk LLM. */
  entries?: CacheEntry[];
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const f2 = (x: number) => x.toFixed(2);

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function summarize(run: MethodRun, gold: EvalItem[]) {
  const s = score(gold, run.predictions);
  const [accLo, accHi] = bootstrapInterval(gold, run.predictions, (g, p) => score(g, p).accuracy);
  const [f1Lo, f1Hi] = bootstrapInterval(gold, run.predictions, (g, p) => score(g, p).macroF1);
  const write = writeOperatingPoint(gold, run.predictions);
  const writeHigh = writeOperatingPoint(gold, run.predictions, "tinggi");

  let latency = null;
  let cost = null;
  if (run.entries && run.entries.length > 0) {
    // Satu nilai per batch, bukan per item, supaya batch besar tidak terhitung
    // berkali-kali.
    const batches = new Map<number, number>();
    for (const e of run.entries) batches.set(e.batchStartedAt, e.batchMs);
    const batchMs = [...batches.values()];
    const perItemMs = run.entries.reduce((sum, e) => sum + e.batchMs / e.batchSize, 0) / run.entries.length;
    latency = {
      batchP50s: percentile(batchMs, 0.5) / 1000,
      batchP95s: percentile(batchMs, 0.95) / 1000,
      secondsPer1000: perItemMs,
    };

    const inputPerItem = run.entries.reduce((sum, e) => sum + e.inputTokens, 0) / run.entries.length;
    const outputPerItem = run.entries.reduce((sum, e) => sum + e.outputTokens, 0) / run.entries.length;
    const price = PRICES[run.label];
    cost = {
      inputTokensPerItem: inputPerItem,
      outputTokensPerItem: outputPerItem,
      usdPer1000: price ? (1000 * (inputPerItem * price.input + outputPerItem * price.output)) / 1e6 : null,
    };
  }

  return {
    label: run.label,
    n: s.n,
    accuracy: s.accuracy,
    accuracyCI: [accLo, accHi],
    macroF1: s.macroF1,
    macroF1CI: [f1Lo, f1Hi],
    failureRate: s.failureRate,
    write,
    writeHigh,
    perClass: s.perClass,
    confusion: s.confusion,
    latency,
    cost,
  };
}

function subsetOf(gold: EvalItem[], which: "semua" | "tanpa_kata_kunci" | "non_waralaba") {
  if (which === "tanpa_kata_kunci") return gold.filter((item) => item.hard);
  if (which === "non_waralaba") return gold.filter((item) => !item.chain);
  return gold;
}

function markdownReport(
  meta: Record<string, unknown>,
  fullRows: ReturnType<typeof summarize>[],
  subsetRows: Record<string, ReturnType<typeof summarize>[]>,
  pairwise: Array<{ a: string; b: string; aOnly: number; bOnly: number; pValue: number }>,
): string {
  const lines: string[] = [];
  lines.push("# Hasil evaluasi kategorisasi nama warung", "");
  lines.push("Dibuat ulang oleh `npm run ml:eval-categorize`. Jangan disunting tangan.", "");
  lines.push("```", JSON.stringify(meta, null, 2), "```", "");

  const header =
    "| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |";
  const sep = "|---|---|---|---|---|---|---|---|---|";
  const row = (r: ReturnType<typeof summarize>) =>
    `| ${r.label} | ${r.n} | ${pct(r.accuracy)} (${pct(r.accuracyCI[0])}–${pct(r.accuracyCI[1])}) | ` +
    `${f2(r.macroF1)} (${f2(r.macroF1CI[0])}–${f2(r.macroF1CI[1])}) | ${pct(r.failureRate)} | ` +
    `${pct(r.write.coverage)} | ${pct(r.write.precision)} | ` +
    `${pct(r.writeHigh.coverage)} | ${pct(r.writeHigh.precision)} |`;

  lines.push("## Subset berimbang (semua metode, item yang sama)", "");
  for (const [name, rows] of Object.entries(subsetRows)) {
    lines.push(`### ${name}`, "", header, sep, ...rows.map(row), "");
  }

  lines.push("## Seluruh split (hanya metode tanpa LLM)", "", header, sep, ...fullRows.map(row), "");

  const llm = subsetRows.semua.filter((r) => r.latency);
  if (llm.length > 0) {
    lines.push("## Biaya dan latensi (subset berimbang)", "");
    lines.push("| Metode | Token in/item | Token out/item | USD per 1.000 warung | Batch p50 | Batch p95 | Waktu per 1.000 warung |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const r of llm) {
      const usd = r.cost?.usdPer1000;
      lines.push(
        `| ${r.label} | ${r.cost!.inputTokensPerItem.toFixed(0)} | ${r.cost!.outputTokensPerItem.toFixed(0)} | ` +
          `${usd === null || usd === undefined ? "—" : `$${usd.toFixed(3)}`} | ${r.latency!.batchP50s.toFixed(1)} s | ` +
          `${r.latency!.batchP95s.toFixed(1)} s | ${(r.latency!.secondsPer1000 / 60).toFixed(1)} menit |`,
      );
    }
    lines.push("");
  }

  if (pairwise.length > 0) {
    lines.push("## Uji McNemar (subset berimbang)", "");
    lines.push("| A | B | Hanya A benar | Hanya B benar | p |", "|---|---|---|---|---|");
    for (const p of pairwise) {
      lines.push(`| ${p.a} | ${p.b} | ${p.aOnly} | ${p.bOnly} | ${p.pValue < 0.001 ? "<0,001" : p.pValue.toFixed(4)} |`);
    }
    lines.push("");
  }

  lines.push("## F1 per slot (subset berimbang)", "");
  const rows = subsetRows.semua;
  lines.push(`| Slot | n | ${rows.map((r) => r.label).join(" | ")} |`);
  lines.push(`|---|---|${rows.map(() => "---").join("|")}|`);
  for (const slot of CUISINE_SLOTS) {
    const support = rows[0]?.perClass.find((c) => c.slot === slot)?.support ?? 0;
    if (support === 0) continue;
    const cells = rows.map((r) => f2(r.perClass.find((c) => c.slot === slot)?.f1 ?? 0));
    lines.push(`| ${slot} | ${support} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  lines.push("## Confusion matrix (subset berimbang)", "", "Baris = label OSM, kolom = tebakan.", "");
  const short = (slot: string) => slot.slice(0, 5);
  for (const r of rows) {
    const cols = [...CUISINE_SLOTS, "tanpa_jawaban"] as const;
    lines.push(`<details><summary>${r.label}</summary>`, "");
    lines.push(`| | ${cols.map(short).join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`);
    for (const g of CUISINE_SLOTS) {
      const counts = cols.map((c) => r.confusion[g][c]);
      if (counts.every((x) => x === 0)) continue;
      lines.push(`| **${short(g)}** | ${counts.map((x) => (x === 0 ? "·" : String(x))).join(" | ")} |`);
    }
    lines.push("", "</details>", "");
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const envFile = resolve(ROOT, ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const split = (arg("split") ?? "test") as Split;
  if (split !== "test" && split !== "dev") throw new Error("--split harus test atau dev.");
  const perClass = Number(arg("per-class") ?? 50);

  const snapshot = JSON.parse(
    readFileSync(resolve(EVAL_DIR, "osm-cuisine.json"), "utf8"),
  ) as OsmSnapshot;
  const { items, stats } = buildDataset(snapshot);
  const evalItems = items.filter((item) => item.split === split);
  const subset = sampleBalanced(evalItems, perClass, SAMPLE_SEED);

  console.log(
    `${stats.places} tempat OSM → ${stats.items} nama unik ` +
      `(train ${stats.bySplit.train}, dev ${stats.bySplit.dev}, test ${stats.bySplit.test}). ` +
      `Subset berimbang ${split}: ${subset.length}.`,
  );

  const providerName = arg("provider");
  if (providerName) await runProvider(providerName, arg("model"), subset, split);

  // --- Kumpulkan semua metode yang punya jawaban lengkap untuk subset ini ---
  const nb = trainTunedNaiveBayes(items);
  const baseRuns = (gold: EvalItem[]): MethodRun[] => [
    { label: "keyword", predictions: keywordPredictions(gold) },
    { label: `naive-bayes (α=${nb.alpha})`, predictions: nbPredictions(nb, gold) },
  ];

  const llmRuns: MethodRun[] = [];
  if (existsSync(CACHE_DIR)) {
    for (const file of readdirSync(CACHE_DIR).sort()) {
      if (!file.endsWith(`.${split}.jsonl`)) continue;
      const cache = readCache(resolve(CACHE_DIR, file));
      const entries = subset.map((item) => cache.get(item.id)).filter((e): e is CacheEntry => !!e);
      const label = entries[0]?.label ?? file;
      if (entries.length < subset.length) {
        console.log(`(${label}: baru ${entries.length}/${subset.length} item, belum masuk laporan)`);
        continue;
      }
      llmRuns.push({
        label,
        entries,
        predictions: entries.map((e) => ({ id: e.id, slot: e.slot, confidence: e.confidence })),
      });
    }
  }

  const subsetRuns = [...baseRuns(subset), ...llmRuns];
  const subsetRows: Record<string, ReturnType<typeof summarize>[]> = {};
  for (const which of ["semua", "tanpa_kata_kunci", "non_waralaba"] as const) {
    const gold = subsetOf(subset, which);
    subsetRows[which] = subsetRuns.map((run) => summarize(run, gold));
  }
  const fullRows = baseRuns(evalItems).map((run) => summarize(run, evalItems));

  const pairwise = [];
  for (let i = 0; i < subsetRuns.length; i += 1) {
    for (let j = i + 1; j < subsetRuns.length; j += 1) {
      const result = mcnemar(subset, subsetRuns[i].predictions, subsetRuns[j].predictions);
      pairwise.push({ a: subsetRuns[i].label, b: subsetRuns[j].label, ...result });
    }
  }

  const meta = {
    split,
    osmBase: snapshot.osmBase,
    dataset: stats,
    subset: {
      perClass,
      seed: SAMPLE_SEED,
      n: subset.length,
      tanpaKataKunci: subset.filter((i) => i.hard).length,
      nonWaralaba: subset.filter((i) => !i.chain).length,
    },
    promptHash: PROMPT_HASH,
    prices: PRICES,
  };

  writeFileSync(
    resolve(EVAL_DIR, `results.${split}.json`),
    `${JSON.stringify({ meta, subset: subsetRows, full: fullRows, pairwise }, null, 2)}\n`,
  );
  writeFileSync(resolve(EVAL_DIR, `results.${split}.md`), markdownReport(meta, fullRows, subsetRows, pairwise));

  console.log("");
  for (const r of subsetRows.semua) {
    console.log(
      `${r.label.padEnd(32)} akurasi ${pct(r.accuracy).padStart(6)}  macro-F1 ${f2(r.macroF1)}  ` +
        `ditulis ${pct(r.write.coverage).padStart(6)} presisi ${pct(r.write.precision)}`,
    );
  }
  console.log(`\nLaporan: ml/eval/results.${split}.md`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
