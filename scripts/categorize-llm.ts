/**
 * Mengkurasi kategori warung "Restaurant" polos dengan Claude.
 *
 *   npx tsx scripts/categorize-llm.ts                 # semua yang perlu
 *   npx tsx scripts/categorize-llm.ts --limit=20      # coba sedikit dulu
 *   npx tsx scripts/categorize-llm.ts --dry-run       # tanpa memanggil API
 *   npx tsx scripts/categorize-llm.ts --min-confidence=tinggi
 *
 * Butuh `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` (dibaca
 * dari `.env.local`) untuk membaca katalog — yang memang publik — dan
 * kredensial Anthropic (`ANTHROPIC_API_KEY` atau profil `ant auth login`).
 *
 * Keluarannya dua berkas di supabase/generated/:
 *   kategori-llm.sql        UPDATE yang siap ditempel ke SQL Editor
 *   kategori-llm.review.md  semua saran, termasuk yang tidak ikut ditulis
 *
 * Skrip ini TIDAK menulis ke database. Alasannya sama dengan ingest OSM:
 * tebakan yang salah jauh lebih mudah dicegat sebelum masuk daripada
 * dibersihkan sesudahnya — apalagi tebakan yang akan dibaca model sebagai
 * fakta.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

import {
  buildUserMessage,
  CONFIDENCE_LEVELS,
  needsCategorization,
  SUGGESTION_SCHEMA,
  SYSTEM_PROMPT,
  suggestionsToReview,
  suggestionsToSql,
  validateSuggestions,
  type CategorizeInput,
  type CategorySuggestion,
  type Confidence,
  type ValidationResult,
} from "@/lib/ml/categorize";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = resolve(ROOT, "supabase/generated");
const MODEL = "claude-opus-5-5";

/**
 * Berapa tempat per permintaan. Cukup besar supaya jumlah panggilan kecil,
 * cukup kecil supaya satu jawaban yang rusak tidak membuang banyak baris.
 */
const BATCH_SIZE = 40;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function loadCatalog(): Promise<CategorizeInput[]> {
  const envFile = resolve(ROOT, ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY belum diisi di .env.local.",
    );
  }

  // Anon key cukup: katalog restoran memang boleh dibaca publik. Skrip ini
  // tidak butuh — dan tidak boleh memakai — service_role.
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, name, category")
    .order("name");

  if (error) throw new Error(`Gagal membaca katalog: ${error.message}`);
  return (data ?? []) as CategorizeInput[];
}

async function categorizeBatch(
  client: Anthropic,
  batch: CategorizeInput[],
): Promise<ValidationResult> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // Klasifikasi dari nama tidak butuh penalaran panjang.
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SUGGESTION_SCHEMA },
    },
    // Kalau classifier keamanan salah menolak, permintaan diulang di model
    // cadangan yang direkomendasikan, bukan langsung gagal.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(batch) }],
  });

  if (response.stop_reason === "refusal") {
    console.warn(`  batch ditolak model (${response.stop_details?.category ?? "tanpa kategori"})`);
    return validateSuggestions(null, batch);
  }
  if (response.stop_reason === "max_tokens") {
    console.warn("  jawaban terpotong (max_tokens); batch ini dilewati");
    return validateSuggestions(null, batch);
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  try {
    return validateSuggestions(JSON.parse(text), batch);
  } catch {
    console.warn("  jawaban bukan JSON yang sah; batch ini dilewati");
    return validateSuggestions(null, batch);
  }
}

async function main(): Promise<void> {
  const minConfidence = (arg("min-confidence") ?? "sedang") as Confidence;
  if (!CONFIDENCE_LEVELS.includes(minConfidence)) {
    throw new Error(`--min-confidence harus salah satu dari: ${CONFIDENCE_LEVELS.join(", ")}`);
  }
  const limit = arg("limit") ? Number(arg("limit")) : Infinity;

  const catalog = await loadCatalog();
  const pending = catalog.filter((row) => needsCategorization(row.category)).slice(0, limit);

  console.log(
    `${catalog.length} tempat di katalog, ${pending.length} akan dikirim ` +
      `(kategori yang sudah jelas tidak disentuh).`,
  );

  const batches: CategorizeInput[][] = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    batches.push(pending.slice(i, i + BATCH_SIZE));
  }

  if (flag("dry-run")) {
    console.log(`\n[dry-run] ${batches.length} permintaan. Contoh pesan pertama:\n`);
    console.log(batches[0] ? buildUserMessage(batches[0]) : "(tidak ada yang perlu dikurasi)");
    return;
  }

  const client = new Anthropic();
  const merged: ValidationResult = { suggestions: [], missing: [], rejected: [] };

  for (const [index, batch] of batches.entries()) {
    console.log(`batch ${index + 1}/${batches.length} (${batch.length} tempat)`);
    try {
      const result = await categorizeBatch(client, batch);
      merged.suggestions.push(...result.suggestions);
      merged.missing.push(...result.missing);
      merged.rejected.push(...result.rejected);
    } catch (error) {
      // Satu batch yang gagal tidak membatalkan batch lain; baris-barisnya
      // tercatat sebagai tanpa jawaban di berkas review.
      if (error instanceof Anthropic.RateLimitError) {
        console.warn("  kena rate limit; jalankan ulang nanti untuk sisanya");
      } else if (error instanceof Anthropic.APIError) {
        console.warn(`  API error ${error.status}: ${error.message}`);
      } else {
        throw error;
      }
      merged.missing.push(...batch.map((row) => row.id));
    }
  }

  const meta = { minConfidence, model: MODEL, generatedAt: new Date().toISOString() };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const sqlPath = resolve(OUTPUT_DIR, "kategori-llm.sql");
  const reviewPath = resolve(OUTPUT_DIR, "kategori-llm.review.md");
  writeFileSync(sqlPath, suggestionsToSql(pending, merged.suggestions, meta));
  writeFileSync(reviewPath, suggestionsToReview(pending, merged, meta));

  const counts = new Map<string, number>();
  for (const s of merged.suggestions as CategorySuggestion[]) {
    counts.set(s.slot, (counts.get(s.slot) ?? 0) + 1);
  }
  console.log("\nSebaran slot:", Object.fromEntries(counts));
  console.log(`\nBaca dulu: ${reviewPath}\nLalu tempel: ${sqlPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
