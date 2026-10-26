/**
 * Provider LLM untuk kurasi kategori, dipakai bersama oleh
 * `categorize-llm.ts` (produksi) dan `eval-categorize.ts` (evaluasi).
 *
 * Semua provider memakai prompt, skema JSON, dan validasi yang sama dari
 * `@/lib/ml/categorize`, jadi yang berbeda di antara mereka hanya modelnya.
 * Itu syarat supaya perbandingan di evaluasi adil, dan supaya angka evaluasi
 * berlaku untuk kode yang benar-benar dipakai di produksi.
 */

import Anthropic from "@anthropic-ai/sdk";

import {
  buildOllamaRequest,
  buildUserMessage,
  SUGGESTION_SCHEMA,
  SYSTEM_PROMPT,
  validateSuggestions,
  type CategorizeInput,
  type ValidationResult,
} from "@/lib/ml/categorize";

export const PROVIDER_NAMES = ["ollama", "claude", "gemini"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export interface ProviderCall {
  result: ValidationResult;
  /** Token yang ditagih atau diproses; 0 kalau provider tidak melaporkannya. */
  usage: { input: number; output: number };
}

export interface Provider {
  /** Dicatat di SQL, berkas review, dan cache evaluasi. */
  label: string;
  /**
   * Berapa tempat per permintaan. Model lokal kecil lebih sering kehilangan
   * jejak di daftar panjang, jadi batch-nya dibuat lebih kecil.
   */
  batchSize: number;
  categorize(batch: CategorizeInput[]): Promise<ProviderCall>;
}

const NO_USAGE = { input: 0, output: 0 };

function parseAnswer(text: string, batch: CategorizeInput[]): ValidationResult {
  try {
    return validateSuggestions(JSON.parse(text), batch);
  } catch {
    console.warn("  jawaban bukan JSON yang sah; batch ini dilewati");
    return validateSuggestions(null, batch);
  }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

/**
 * Ollama tidak bisa dihubungi atau mati di tengah jawaban. Biasanya sementara:
 * di laptop dengan RAM pas-pasan, kernel bisa membunuh proses model saat
 * memori habis, lalu systemd menyalakan Ollama lagi beberapa detik kemudian.
 */
class OllamaUnavailable extends Error {}

function ollamaProvider(model?: string): Provider {
  const host = (process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, "");
  const name = model ?? process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

  async function once(batch: CategorizeInput[]): Promise<ProviderCall> {
    let response: Response;
    try {
      response = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildOllamaRequest(batch, name)),
      });
    } catch (error) {
      throw new OllamaUnavailable(
        `Tidak bisa menghubungi Ollama di ${host}. Sudah dijalankan? (ollama serve)`,
        { cause: error },
      );
    }

    if (response.status === 404) {
      throw new Error(`Model "${name}" belum diunduh. Jalankan: ollama pull ${name}`);
    }
    if (!response.ok || !response.body) {
      throw new OllamaUnavailable(`Ollama menjawab ${response.status}: ${await response.text()}`);
    }

    // Jawabannya di-stream (NDJSON). Tanpa streaming, header baru datang
    // setelah seluruh jawaban selesai, dan fetch bawaan Node menyerah setelah
    // 300 detik menunggu header — batas yang mudah terlewati di CPU.
    let content = "";
    let usage = NO_USAGE;
    let doneReason = "";
    let buffer = "";
    const decoder = new TextDecoder();
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const part = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
            done_reason?: string;
            prompt_eval_count?: number;
            eval_count?: number;
            error?: string;
          };
          if (part.error) throw new OllamaUnavailable(`Ollama: ${part.error}`);
          content += part.message?.content ?? "";
          if (part.done) {
            doneReason = part.done_reason ?? "";
            usage = { input: part.prompt_eval_count ?? 0, output: part.eval_count ?? 0 };
          }
        }
      }
    } catch (error) {
      if (error instanceof OllamaUnavailable) throw error;
      throw new OllamaUnavailable("Koneksi ke Ollama terputus di tengah jawaban.", { cause: error });
    }

    if (doneReason === "length") {
      console.warn("  jawaban terpotong (batas konteks); batch ini dilewati");
      return { result: validateSuggestions(null, batch), usage };
    }
    return { result: parseAnswer(content, batch), usage };
  }

  return {
    label: `ollama/${name}`,
    batchSize: 10,
    async categorize(batch) {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await once(batch);
        } catch (error) {
          if (!(error instanceof OllamaUnavailable) || attempt === 4) throw error;
          const waitSeconds = 15 * attempt;
          console.warn(`  ${error.message} Coba lagi dalam ${waitSeconds}s…`);
          await sleep(waitSeconds * 1000);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const CLAUDE_MODEL = "claude-opus-5-5";

function claudeProvider(model?: string): Provider {
  const client = new Anthropic();
  const name = model ?? CLAUDE_MODEL;

  return {
    label: name,
    batchSize: 40,
    async categorize(batch) {
      try {
        const response = await client.beta.messages.create({
          model: name,
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
        const usage = {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
        };

        if (response.stop_reason === "refusal") {
          console.warn(
            `  batch ditolak model (${response.stop_details?.category ?? "tanpa kategori"})`,
          );
          return { result: validateSuggestions(null, batch), usage };
        }
        if (response.stop_reason === "max_tokens") {
          console.warn("  jawaban terpotong (max_tokens); batch ini dilewati");
          return { result: validateSuggestions(null, batch), usage };
        }

        const text = response.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");
        return { result: parseAnswer(text, batch), usage };
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
        return { result: validateSuggestions(null, batch), usage: NO_USAGE };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Gemini (Interactions API)
// ---------------------------------------------------------------------------

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

interface GeminiInteraction {
  status?: string;
  output_text?: string;
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: { total_input_tokens?: number; total_output_tokens?: number };
  error?: { message?: string };
}

/** Teks jawaban model dari sebuah interaction. */
export function geminiOutputText(body: GeminiInteraction): string {
  if (typeof body.output_text === "string") return body.output_text;
  return (body.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function geminiProvider(model?: string): Provider {
  const name = model ?? process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";

  return {
    label: `gemini/${name}`,
    batchSize: 40,
    async categorize(batch) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY belum diisi di .env.local.");

      const request = JSON.stringify({
        model: name,
        system_instruction: SYSTEM_PROMPT,
        input: buildUserMessage(batch),
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: SUGGESTION_SCHEMA,
        },
        // Interaksi tidak perlu disimpan di server Google.
        store: false,
      });

      // Free tier punya batas permintaan per menit. 429 dan 503 dicoba ulang
      // dengan jeda yang melebar, bukan langsung dianggap gagal.
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const response = await fetch(GEMINI_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: request,
        });

        if (response.status === 429 || response.status === 503) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 20 * attempt;
          console.warn(`  Gemini ${response.status}, tunggu ${waitSeconds}s…`);
          await sleep(waitSeconds * 1000);
          continue;
        }

        const body = (await response.json()) as GeminiInteraction;
        const usage = {
          input: body.usage?.total_input_tokens ?? 0,
          output: body.usage?.total_output_tokens ?? 0,
        };
        if (!response.ok) {
          console.warn(`  Gemini ${response.status}: ${body.error?.message ?? "tanpa pesan"}`);
          return { result: validateSuggestions(null, batch), usage };
        }
        if (body.status && body.status !== "completed") {
          console.warn(`  interaction berstatus ${body.status}; batch ini dilewati`);
          return { result: validateSuggestions(null, batch), usage };
        }
        return { result: parseAnswer(geminiOutputText(body), batch), usage };
      }

      console.warn("  Gemini terus sibuk; jalankan ulang nanti untuk sisanya");
      return { result: validateSuggestions(null, batch), usage: NO_USAGE };
    },
  };
}

export function createProvider(name: string, model?: string): Provider {
  switch (name) {
    case "ollama":
      return ollamaProvider(model);
    case "claude":
      return claudeProvider(model);
    case "gemini":
      return geminiProvider(model);
    default:
      throw new Error(`--provider harus salah satu dari: ${PROVIDER_NAMES.join(", ")}.`);
  }
}
