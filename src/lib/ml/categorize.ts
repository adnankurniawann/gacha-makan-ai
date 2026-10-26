/**
 * Kurasi kategori warung dengan bantuan LLM — bagian yang murni.
 *
 * Masalah yang diselesaikan: sebagian besar baris seed berkategori
 * "Restaurant" polos, yang jatuh ke slot `lainnya`. Selama itu belum
 * dikurasi, 12 dari 26 dimensi fitur model praktis kosong. Ini masalah data,
 * bukan masalah model, dan LLM cocok untuknya: menebak "Ayam Crisbar" itu
 * warung ayam adalah pekerjaan bahasa, bukan pekerjaan statistik.
 *
 * Tapi tebakan tetap tebakan. Karena itu bentuknya sama dengan ingest OSM:
 * keluarannya SQL untuk direview, bukan tulisan langsung ke database. Yang
 * tidak yakin tidak ikut ditulis sama sekali — README sudah menetapkan bahwa
 * yang tidak diketahui tetap tidak diketahui, bukan ditebak.
 *
 * Pemanggilan API-nya ada di `scripts/categorize-llm.ts`. Berkas ini tidak
 * menyentuh jaringan supaya validasi dan pembuatan SQL-nya bisa diuji.
 */

import {
  CUISINE_LABELS,
  CUISINE_SLOTS,
  toCuisineSlot,
  type CuisineSlot,
} from "@/lib/ml/taxonomy";

export interface CategorizeInput {
  id: string;
  name: string;
  /** Isi kolom `category` saat ini, apa adanya. */
  category: string | null;
}

export const CONFIDENCE_LEVELS = ["tinggi", "sedang", "rendah"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export interface CategorySuggestion {
  id: string;
  slot: CuisineSlot;
  confidence: Confidence;
  /** Satu kalimat pendek; dibaca reviewer, tidak masuk ke database. */
  reason: string;
}

/**
 * Apakah baris ini perlu dikurasi.
 *
 * Hanya yang sekarang jatuh ke `lainnya`. Kategori yang sudah dipetakan ke
 * slot tertentu — entah dari kurasi manual atau dari OSM — tidak disentuh:
 * mengganti data yang sudah benar dengan tebakan model adalah kemunduran.
 */
export function needsCategorization(category: string | null): boolean {
  return toCuisineSlot(category) === "lainnya";
}

/**
 * Skema keluaran untuk structured outputs.
 *
 * `slot` dibatasi lewat enum, jadi model tidak bisa mengarang slot baru. `id`
 * tetap divalidasi di `validateSuggestions` — enum tidak bisa mencegah model
 * menyalin id yang salah.
 */
export const SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          slot: { type: "string", enum: [...CUISINE_SLOTS] },
          confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
          reason: { type: "string" },
        },
        required: ["id", "slot", "confidence", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
} as const;

const SLOT_GUIDE: Record<CuisineSlot, string> = {
  ayam: "ayam goreng/geprek/penyet/bakar sebagai menu utama",
  mie: "mie ayam, bakso, ramen, bakmi, kwetiau kuah",
  nusantara: "warteg, warung nasi, prasmanan, masakan Jawa/Indonesia umum",
  sunda: "masakan Sunda: nasi liwet, pepes, lalapan, sambal khas Sunda",
  padang: "nasi Padang, masakan Minang",
  chinese: "masakan Tionghoa, dimsum, capcay",
  jepang_korea: "masakan Jepang atau Korea",
  barat: "burger, pizza, steak, pasta, ayam goreng cepat saji gaya Barat",
  seafood: "ikan, udang, kerang, seafood sebagai menu utama",
  kopi_minuman: "kedai kopi, kafe, warkop, minuman sebagai jualan utama",
  manis_roti: "roti, kue, martabak, dessert, es krim",
  lainnya: "tidak bisa ditentukan dari nama, atau tidak cocok di slot mana pun",
};

/**
 * Instruksi sistem. Statis, supaya bisa di-cache dan supaya hasil dua kali
 * jalan bisa dibandingkan.
 */
export const SYSTEM_PROMPT = [
  "Kamu membantu mengkurasi katalog warung makan di sekitar kampus Jatinangor, Jawa Barat.",
  "Untuk tiap tempat, pilih SATU slot masakan berdasarkan nama tempatnya.",
  "",
  "Slot yang tersedia:",
  ...CUISINE_SLOTS.map((slot) => `- ${slot}: ${SLOT_GUIDE[slot]}`),
  "",
  "Aturan:",
  "- Nama sering menyebut menu utamanya (\"Ayam Geprek ...\", \"Mie ...\", \"Warkop ...\"). Pakai itu.",
  "- Kalau nama tidak memberi petunjuk tentang makanannya (misalnya hanya nama orang atau nama tempat), pilih `lainnya`. Jangan menebak dari pengetahuan umum tentang merek yang tidak kamu yakini.",
  "- confidence `tinggi` hanya kalau nama menyebut jenis makanannya secara langsung. `sedang` kalau ada petunjuk tapi tidak langsung. Selain itu `rendah`.",
  "- reason: satu kalimat pendek dalam bahasa Indonesia, sebut kata di nama yang jadi petunjuknya.",
  "- Kembalikan tepat satu entri untuk tiap id yang diberikan, dengan id yang disalin persis.",
].join("\n");

/** Pesan pengguna untuk satu batch. */
export function buildUserMessage(batch: CategorizeInput[]): string {
  const lines = batch.map((row) =>
    JSON.stringify({ id: row.id, nama: row.name, kategori_sekarang: row.category }),
  );
  return `Tentukan slot untuk ${batch.length} tempat berikut (satu JSON per baris):\n\n${lines.join("\n")}`;
}

/**
 * Badan permintaan untuk `POST /api/chat` Ollama.
 *
 * `format` diisi skema JSON yang sama dengan yang dipakai untuk Claude, jadi
 * model lokal pun dipaksa menjawab dengan bentuk dan enum slot yang sama.
 * Temperatur 0 supaya dua kali jalan memberi hasil yang bisa dibandingkan.
 */
export function buildOllamaRequest(batch: CategorizeInput[], model: string) {
  return {
    model,
    stream: false,
    format: SUGGESTION_SCHEMA,
    options: { temperature: 0 },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(batch) },
    ],
  };
}

export interface ValidationResult {
  suggestions: CategorySuggestion[];
  /** Id dari batch yang tidak mendapat jawaban sah. */
  missing: string[];
  /** Entri yang dibuang, dengan alasannya — dicatat di berkas review. */
  rejected: Array<{ entry: unknown; reason: string }>;
}

/**
 * Memeriksa jawaban model terhadap batch yang dikirim.
 *
 * Structured outputs menjamin bentuknya, bukan isinya. Yang dicegat di sini:
 * id yang tidak ada di batch (model salah salin), id ganda, dan nilai di luar
 * enum kalau suatu saat skemanya tidak dipaksakan.
 */
export function validateSuggestions(
  raw: unknown,
  batch: CategorizeInput[],
): ValidationResult {
  const expected = new Set(batch.map((row) => row.id));
  const seen = new Set<string>();
  const suggestions: CategorySuggestion[] = [];
  const rejected: ValidationResult["rejected"] = [];

  const list =
    raw !== null && typeof raw === "object" && Array.isArray((raw as { suggestions?: unknown }).suggestions)
      ? ((raw as { suggestions: unknown[] }).suggestions)
      : [];

  for (const entry of list) {
    if (entry === null || typeof entry !== "object") {
      rejected.push({ entry, reason: "bukan objek" });
      continue;
    }
    const { id, slot, confidence, reason } = entry as Record<string, unknown>;

    if (typeof id !== "string" || !expected.has(id)) {
      rejected.push({ entry, reason: "id tidak ada di batch" });
      continue;
    }
    if (seen.has(id)) {
      rejected.push({ entry, reason: "id ganda" });
      continue;
    }
    if (typeof slot !== "string" || !(CUISINE_SLOTS as readonly string[]).includes(slot)) {
      rejected.push({ entry, reason: "slot tidak dikenal" });
      continue;
    }
    if (
      typeof confidence !== "string" ||
      !(CONFIDENCE_LEVELS as readonly string[]).includes(confidence)
    ) {
      rejected.push({ entry, reason: "confidence tidak dikenal" });
      continue;
    }

    seen.add(id);
    suggestions.push({
      id,
      slot: slot as CuisineSlot,
      confidence: confidence as Confidence,
      reason: typeof reason === "string" ? reason.trim() : "",
    });
  }

  const missing = batch.map((row) => row.id).filter((id) => !seen.has(id));
  return { suggestions, missing, rejected };
}

const CONFIDENCE_RANK: Record<Confidence, number> = { rendah: 0, sedang: 1, tinggi: 2 };

/**
 * Apakah saran ini ikut ditulis ke SQL.
 *
 * `lainnya` tidak pernah ditulis: mengganti "Restaurant" dengan "tidak tahu"
 * tidak menambah informasi apa pun.
 */
export function isApplicable(
  suggestion: CategorySuggestion,
  minConfidence: Confidence,
): boolean {
  return (
    suggestion.slot !== "lainnya" &&
    CONFIDENCE_RANK[suggestion.confidence] >= CONFIDENCE_RANK[minConfidence]
  );
}

function sqlString(value: string | null): string {
  if (value === null) return "null";
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * SQL UPDATE untuk saran yang lolos.
 *
 * Setiap UPDATE menyertakan kategori lamanya di WHERE. Kalau seseorang sudah
 * mengkurasi baris itu dengan tangan di antara saat skrip jalan dan saat SQL
 * ditempel, barisnya tidak tertimpa — kurasi manusia selalu menang.
 */
export function suggestionsToSql(
  rows: CategorizeInput[],
  suggestions: CategorySuggestion[],
  options: { minConfidence: Confidence; model: string; generatedAt: string },
): string {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const applicable = suggestions.filter((s) => isApplicable(s, options.minConfidence));

  const lines = [
    "-- Dihasilkan oleh scripts/categorize-llm.ts — BACA berkas .review.md dulu.",
    `-- Model: ${options.model} · ${options.generatedAt}`,
    `-- Ambang confidence: ${options.minConfidence} · ${applicable.length} baris diperbarui`,
    "--",
    "-- Tiap UPDATE hanya berlaku kalau kategorinya masih sama seperti saat",
    "-- skrip dijalankan. Kurasi manual yang masuk belakangan tidak tertimpa.",
    "",
    "begin;",
    "",
  ];

  for (const suggestion of applicable) {
    const row = byId.get(suggestion.id);
    if (!row || suggestion.slot === "lainnya") continue;
    const label = CUISINE_LABELS[suggestion.slot];
    lines.push(`-- ${row.name} → ${suggestion.slot} (${suggestion.confidence}): ${suggestion.reason}`);
    lines.push(
      `update public.restaurants set category = ${sqlString(label)} ` +
        `where id = ${sqlString(row.id)} and category is not distinct from ${sqlString(row.category)};`,
    );
    lines.push("");
  }

  lines.push("commit;", "");
  return lines.join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Berkas review: semua saran, termasuk yang TIDAK ikut ditulis. */
export function suggestionsToReview(
  rows: CategorizeInput[],
  result: ValidationResult,
  options: { minConfidence: Confidence; model: string; generatedAt: string },
): string {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const applied = result.suggestions.filter((s) => isApplicable(s, options.minConfidence));
  const skipped = result.suggestions.filter((s) => !isApplicable(s, options.minConfidence));

  const table = (items: CategorySuggestion[]) => [
    "| Nama | Kategori lama | Slot | Confidence | Alasan |",
    "|---|---|---|---|---|",
    ...items.map((s) => {
      const row = byId.get(s.id);
      return `| ${escapeCell(row?.name ?? s.id)} | ${escapeCell(row?.category ?? "—")} | ${s.slot} | ${s.confidence} | ${escapeCell(s.reason)} |`;
    }),
  ];

  const lines = [
    "# Review kategorisasi LLM",
    "",
    `Model \`${options.model}\`, ${options.generatedAt}. Ambang: **${options.minConfidence}**.`,
    "",
    `- ${rows.length} tempat dikirim`,
    `- ${applied.length} akan diperbarui oleh SQL`,
    `- ${skipped.length} dilewati (\`lainnya\` atau di bawah ambang)`,
    `- ${result.missing.length} tanpa jawaban sah`,
    "",
    "Periksa terutama yang `sedang`: petunjuknya tidak langsung, dan satu",
    "salah kategori di sini akan ikut terbaca model sebagai fakta.",
    "",
    "## Akan diperbarui",
    "",
    ...table(applied),
    "",
    "## Dilewati",
    "",
    ...table(skipped),
    "",
  ];

  if (result.missing.length > 0 || result.rejected.length > 0) {
    lines.push("## Tanpa jawaban sah", "");
    for (const id of result.missing) {
      lines.push(`- ${byId.get(id)?.name ?? id}`);
    }
    for (const { entry, reason } of result.rejected) {
      lines.push(`- dibuang (${reason}): \`${escapeCell(JSON.stringify(entry))}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}
