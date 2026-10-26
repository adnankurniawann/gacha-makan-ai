import { describe, expect, it } from "vitest";

import {
  buildOllamaRequest,
  buildUserMessage,
  isApplicable,
  needsCategorization,
  suggestionsToReview,
  suggestionsToSql,
  SUGGESTION_SCHEMA,
  validateSuggestions,
  type CategorizeInput,
} from "@/lib/ml/categorize";
import { CUISINE_LABELS, CUISINE_SLOTS, toCuisineSlot } from "@/lib/ml/taxonomy";

const batch: CategorizeInput[] = [
  { id: "a", name: "Ayam Crisbar Jatinangor", category: "Restaurant" },
  { id: "b", name: "Warung Tek Las", category: "Restaurant" },
  { id: "c", name: "Kedai O'Neil", category: null },
];

const options = { minConfidence: "sedang" as const, model: "m", generatedAt: "t" };

describe("CUISINE_LABELS", () => {
  it("setiap label dipetakan kembali ke slotnya sendiri", () => {
    // Label yang jatuh ke slot lain akan diam-diam merusak fitur model.
    for (const [slot, label] of Object.entries(CUISINE_LABELS)) {
      expect(toCuisineSlot(label)).toBe(slot);
    }
  });

  it("punya label untuk semua slot kecuali lainnya", () => {
    expect(Object.keys(CUISINE_LABELS).sort()).toEqual(
      CUISINE_SLOTS.filter((slot) => slot !== "lainnya").sort(),
    );
  });
});

describe("needsCategorization", () => {
  it("hanya baris yang sekarang jatuh ke lainnya", () => {
    expect(needsCategorization("Restaurant")).toBe(true);
    expect(needsCategorization(null)).toBe(true);
    expect(needsCategorization("Chicken restaurant")).toBe(false);
    expect(needsCategorization("Sunda")).toBe(false);
  });
});

describe("SUGGESTION_SCHEMA", () => {
  it("membatasi slot ke daftar yang tetap", () => {
    const slotSchema = SUGGESTION_SCHEMA.properties.suggestions.items.properties.slot;
    expect(slotSchema.enum).toEqual([...CUISINE_SLOTS]);
  });
});

describe("buildUserMessage", () => {
  it("menyertakan setiap id persis satu kali", () => {
    const message = buildUserMessage(batch);
    for (const row of batch) {
      expect(message.split(`"id":"${row.id}"`).length - 1).toBe(1);
    }
  });
});

describe("buildOllamaRequest", () => {
  it("memakai skema dan prompt yang sama dengan Claude", () => {
    const body = buildOllamaRequest(batch, "qwen2.5:7b");
    expect(body.model).toBe("qwen2.5:7b");
    expect(body.stream).toBe(true);
    expect(body.format).toBe(SUGGESTION_SCHEMA);
    expect(body.options.temperature).toBe(0);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toBe(buildUserMessage(batch));
  });
});

describe("validateSuggestions", () => {
  it("membuang id asing, id ganda, dan slot karangan", () => {
    const result = validateSuggestions(
      {
        suggestions: [
          { id: "a", slot: "ayam", confidence: "tinggi", reason: "ada kata Ayam" },
          { id: "a", slot: "mie", confidence: "tinggi", reason: "ganda" },
          { id: "zzz", slot: "ayam", confidence: "tinggi", reason: "asing" },
          { id: "b", slot: "sate", confidence: "sedang", reason: "karangan" },
        ],
      },
      batch,
    );

    expect(result.suggestions.map((s) => s.id)).toEqual(["a"]);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      "id ganda",
      "id tidak ada di batch",
      "slot tidak dikenal",
    ]);
    expect(result.missing).toEqual(["b", "c"]);
  });

  it("tidak melempar untuk jawaban yang bentuknya rusak", () => {
    expect(validateSuggestions(null, batch).missing).toEqual(["a", "b", "c"]);
    expect(validateSuggestions({ suggestions: "x" }, batch).suggestions).toEqual([]);
  });
});

describe("isApplicable", () => {
  it("tidak pernah menulis lainnya, berapa pun confidence-nya", () => {
    expect(
      isApplicable({ id: "a", slot: "lainnya", confidence: "tinggi", reason: "" }, "rendah"),
    ).toBe(false);
  });

  it("menghormati ambang", () => {
    const s = { id: "a", slot: "ayam" as const, confidence: "sedang" as const, reason: "" };
    expect(isApplicable(s, "sedang")).toBe(true);
    expect(isApplicable(s, "tinggi")).toBe(false);
  });
});

describe("suggestionsToSql", () => {
  const suggestions = [
    { id: "a", slot: "ayam" as const, confidence: "tinggi" as const, reason: "Ayam" },
    { id: "b", slot: "lainnya" as const, confidence: "rendah" as const, reason: "-" },
    { id: "c", slot: "kopi_minuman" as const, confidence: "sedang" as const, reason: "Kedai" },
  ];

  it("hanya memperbarui yang lolos, dengan kategori lama sebagai penjaga", () => {
    const sql = suggestionsToSql(batch, suggestions, options);

    expect(sql).toContain(
      "update public.restaurants set category = 'Ayam' where id = 'a' and category is not distinct from 'Restaurant';",
    );
    expect(sql).not.toContain("where id = 'b'");
    // null harus tetap null di WHERE, bukan string 'null'.
    expect(sql).toContain("where id = 'c' and category is not distinct from null;");
    expect(sql.trim().startsWith("--")).toBe(true);
    expect(sql).toContain("begin;");
    expect(sql).toContain("commit;");
  });

  it("meloloskan tanda kutip di nama", () => {
    const sql = suggestionsToSql(
      [{ id: "x'y", name: "O'Neil", category: "Bar'" }],
      [{ id: "x'y", slot: "barat", confidence: "tinggi", reason: "" }],
      options,
    );
    expect(sql).toContain("where id = 'x''y' and category is not distinct from 'Bar''';");
  });
});

describe("suggestionsToReview", () => {
  it("mencatat yang dilewati dan yang tanpa jawaban", () => {
    const result = validateSuggestions(
      { suggestions: [{ id: "a", slot: "ayam", confidence: "tinggi", reason: "Ayam" }] },
      batch,
    );
    const review = suggestionsToReview(batch, result, options);
    expect(review).toContain("1 akan diperbarui");
    expect(review).toContain("2 tanpa jawaban sah");
    expect(review).toContain("Warung Tek Las");
  });
});
