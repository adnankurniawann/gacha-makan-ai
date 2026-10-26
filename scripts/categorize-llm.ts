/**
 * Mengkurasi kategori warung "Restaurant" polos dengan LLM.
 *
 *   npx tsx scripts/categorize-llm.ts                    # Ollama lokal (default)
 *   npx tsx scripts/categorize-llm.ts --provider=claude  # Claude API
 *   npx tsx scripts/categorize-llm.ts --provider=gemini  # Gemini API
 *   npx tsx scripts/categorize-llm.ts --model=qwen2.5:3b # model lain di provider itu
 *   npx tsx scripts/categorize-llm.ts --limit=10         # coba sedikit dulu
 *   npx tsx scripts/categorize-llm.ts --dry-run          # tanpa memanggil model
 *   npx tsx scripts/categorize-llm.ts --min-confidence=tinggi
 *
 * Butuh `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` (dibaca
 * dari `.env.local`) untuk membaca katalog — yang memang publik — ditambah
 * salah satu dari:
 *
 *   ollama  Ollama berjalan di laptop (gratis). `OLLAMA_MODEL` default
 *           qwen2.5:7b, `OLLAMA_HOST` default http://localhost:11434
 *   claude  `ANTHROPIC_API_KEY` atau profil `ant auth login` (berbayar)
 *   gemini  `GEMINI_API_KEY`; `GEMINI_MODEL` default gemini-3.5-flash-lite
 *
 * Semua provider (scripts/lib/llm-providers.ts) memakai prompt, skema JSON,
 * dan validasi yang sama persis, jadi hasilnya bisa dibandingkan dan diganti
 * tanpa mengubah apa pun lagi. Mana yang terbaik: lihat
 * `npm run ml:eval-categorize`.
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

import { createClient } from "@supabase/supabase-js";

import {
  buildUserMessage,
  CONFIDENCE_LEVELS,
  needsCategorization,
  suggestionsToReview,
  suggestionsToSql,
  type CategorizeInput,
  type CategorySuggestion,
  type Confidence,
  type ValidationResult,
} from "@/lib/ml/categorize";

import { createProvider } from "./lib/llm-providers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = resolve(ROOT, "supabase/generated");

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function loadCatalog(): Promise<CategorizeInput[]> {
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

async function main(): Promise<void> {
  const envFile = resolve(ROOT, ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const minConfidence = (arg("min-confidence") ?? "sedang") as Confidence;
  if (!CONFIDENCE_LEVELS.includes(minConfidence)) {
    throw new Error(`--min-confidence harus salah satu dari: ${CONFIDENCE_LEVELS.join(", ")}`);
  }
  const limit = arg("limit") ? Number(arg("limit")) : Infinity;

  const provider = createProvider(arg("provider") ?? "ollama", arg("model"));

  const catalog = await loadCatalog();
  const pending = catalog.filter((row) => needsCategorization(row.category)).slice(0, limit);

  console.log(
    `${catalog.length} tempat di katalog, ${pending.length} akan dikirim ke ${provider.label} ` +
      `(kategori yang sudah jelas tidak disentuh).`,
  );

  const batches: CategorizeInput[][] = [];
  for (let i = 0; i < pending.length; i += provider.batchSize) {
    batches.push(pending.slice(i, i + provider.batchSize));
  }

  if (flag("dry-run")) {
    console.log(`\n[dry-run] ${batches.length} permintaan. Contoh pesan pertama:\n`);
    console.log(batches[0] ? buildUserMessage(batches[0]) : "(tidak ada yang perlu dikurasi)");
    return;
  }

  const merged: ValidationResult = { suggestions: [], missing: [], rejected: [] };

  for (const [index, batch] of batches.entries()) {
    const startedAt = Date.now();
    process.stdout.write(`batch ${index + 1}/${batches.length} (${batch.length} tempat) … `);
    const { result } = await provider.categorize(batch);
    console.log(`${((Date.now() - startedAt) / 1000).toFixed(0)} detik`);
    merged.suggestions.push(...result.suggestions);
    merged.missing.push(...result.missing);
    merged.rejected.push(...result.rejected);
  }

  const meta = { minConfidence, model: provider.label, generatedAt: new Date().toISOString() };
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
