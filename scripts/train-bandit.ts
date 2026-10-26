/**
 * Melatih bandit dari log spin dan menulis bundle yang dibaca /api/spin.
 *
 *   npx tsx scripts/train-bandit.ts --input=spins.csv
 *   npx tsx scripts/train-bandit.ts --input=ml/data/synthetic-spins.json
 *
 * Ekspor `spins.csv` dari SQL Editor dengan kueri yang dicetak oleh
 * `--print-sql`. Keluarannya ml/bandit.json (atau --out=...).
 *
 * Model dilatih dari SELURUH log. Untuk tahu apakah ia lebih baik dari
 * kebijakan sekarang, jalankan evaluate-bandit lebih dulu — skrip itu melatih
 * pada bagian awal dan menilai pada bagian akhir, sesuatu yang tidak bisa
 * dilakukan pada model yang sudah melihat semuanya.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BUNDLE_FORMAT_VERSION, servingBlocker, type BanditBundle } from "@/lib/ml/bundle";
import { trainModel } from "@/lib/ml/model";
import { BANDIT_POLICY } from "@/lib/ml/policy";
import { buildTrainingSet, PriorTracker } from "@/lib/ml/training";

import { arg, flag, isSyntheticLog, loadSpinRows, SPIN_EXPORT_SQL } from "./lib/spin-export";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function main(): void {
  if (flag("print-sql")) {
    console.log(SPIN_EXPORT_SQL);
    return;
  }

  const input = arg("input");
  if (!input) {
    throw new Error("Pakai --input=<ekspor spin .csv/.json>. Lihat --print-sql untuk kuerinya.");
  }
  const out = resolve(ROOT, arg("out") ?? "ml/bandit.json");

  const rows = loadSpinRows(resolve(input));
  const tracker = new PriorTracker();
  const examples = buildTrainingSet(rows, tracker);
  const accepted = examples.filter((example) => example.reward === 1).length;

  const bundle: BanditBundle = {
    bundleVersion: BUNDLE_FORMAT_VERSION,
    model: trainModel(examples, { policy: BANDIT_POLICY }),
    snapshot: tracker.snapshot(),
    synthetic: isSyntheticLog(rows),
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(bundle)}\n`);

  console.log(`${rows.length} baris, ${examples.length} berlabel, ${accepted} diterima.`);
  console.log(`Bundle ditulis ke ${out}`);
  if (bundle.synthetic) console.log("Ditandai SINTETIS — tidak akan dipakai menyajikan.");

  const blocker = servingBlocker(bundle);
  if (blocker) console.log(`Belum boleh menyajikan: ${blocker}.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
