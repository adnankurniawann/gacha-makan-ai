/**
 * Mengkurasi kategori warung "Restaurant" polos dengan LLM.
 *
 *   npx tsx scripts/categorize-llm.ts                    # Ollama lokal (default)
 *   npx tsx scripts/categorize-llm.ts --provider=claude  # Claude API
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
 *
 * Kedua provider memakai prompt, skema JSON, dan validasi yang sama persis,
 * jadi hasilnya bisa dibandingkan dan diganti tanpa mengubah apa pun lagi.
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
  buildOllamaRequest,
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
const CLAUDE_MODEL = "claude-opus-5-5";

interface Provider {
  /** Dicatat di SQL dan berkas review, supaya jelas hasil siapa yang ditempel. */
  label: string;
  /**
   * Berapa tempat per permintaan. Model lokal kecil lebih sering kehilangan
   * jejak di daftar panjang, jadi batch-nya dibuat lebih kecil.
   */
  batchSize: number;
  categorize(batch: CategorizeInput[]): Promise<ValidationResult>;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseAnswer(text: string, batch: CategorizeInput[]): ValidationResult {
  try {
    return validateSuggestions(JSON.parse(text), batch);
  } catch {
    console.warn("  jawaban bukan JSON yang sah; batch ini dilewati");
    return validateSuggestions(null, batch);
  }
}

function ollamaProvider(): Provider {
  const host = (process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

  return {
    label: `ollama/${model}`,
    batchSize: 10,
    async categorize(batch) {
      let response: Response;
      try {
        response = await fetch(`${host}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildOllamaRequest(batch, model)),
        });
      } catch {
        throw new Error(
          `Tidak bisa menghubungi Ollama di ${host}. Sudah dijalankan? (ollama serve)`,
        );
      }

      if (response.status === 404) {
        throw new Error(`Model "${model}" belum diunduh. Jalankan: ollama pull ${model}`);
      }
      if (!response.ok) {
        throw new Error(`Ollama menjawab ${response.status}: ${await response.text()}`);
      }

      const body = (await response.json()) as { message?: { content?: string } };
      return parseAnswer(body.message?.content ?? "", batch);
    },
  };
}

function claudeProvider(): Provider {
  const client = new Anthropic();

  return {
    label: CLAUDE_MODEL,
    batchSize: 40,
    async categorize(batch) {
      try {
        const response = await client.beta.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 16000,
          // Klasifikasi dari nama tidak butuh penalaran panjang.
          output_config: {
            effort: "low",
            format: { type: "json_schema", schema: SUGGESTION_SCHEMA },
          },
          // Kalau classifier keamanan salah menolak, permintaan diulang di
          // model cadangan yang direkomendasikan, bukan langsung gagal.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildUserMessage(batch) }],
        });

        if (response.stop_reason === "refusal") {
          console.warn(
            `  batch ditolak model (${response.stop_details?.category ?? "tanpa kategori"})`,
          );
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
        return parseAnswer(text, batch);
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
        return validateSuggestions(null, batch);
      }
    },
  };
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

  const providerName = arg("provider") ?? "ollama";
  if (providerName !== "ollama" && providerName !== "claude") {
    throw new Error("--provider harus ollama atau claude.");
  }
  const provider = providerName === "claude" ? claudeProvider() : ollamaProvider();

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
    const result = await provider.categorize(batch);
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
