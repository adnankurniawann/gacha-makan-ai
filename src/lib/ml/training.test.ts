import { describe, expect, it } from "vitest";

import { FEATURE_NAMES } from "@/lib/ml/features";
import { buildTrainingSet, type RawSpinRow } from "@/lib/ml/training";

const indexOf = (name: string) => FEATURE_NAMES.indexOf(name);

let counter = 0;

function row(overrides: Partial<RawSpinRow> = {}): RawSpinRow {
  counter += 1;
  return {
    id: `evt-${String(counter).padStart(3, "0")}`,
    user_id: "user-a",
    restaurant_id: "resto-1",
    shown_at: `2026-08-0${Math.min(9, counter)}T05:00:00Z`,
    category: "Ayam",
    price_tier: 15000,
    distance_km: 0.4,
    hour_local: 12,
    day_of_week: 3,
    is_raining: false,
    effective_action: "accepted",
    policy_score: 0.25,
    policy: "weighted_budget_v1",
    ...overrides,
  };
}

describe("buildTrainingSet", () => {
  it("mengurutkan berdasarkan waktu penayangan, bukan urutan masukan", () => {
    const examples = buildTrainingSet([
      row({ id: "b", shown_at: "2026-08-02T05:00:00Z" }),
      row({ id: "a", shown_at: "2026-08-01T05:00:00Z" }),
      row({ id: "c", shown_at: "2026-08-03T05:00:00Z" }),
    ]);

    expect(examples.map((e) => e.eventId)).toEqual(["a", "b", "c"]);
  });

  it("deterministik saat dua penayangan punya waktu yang sama persis", () => {
    const same = "2026-08-01T05:00:00Z";
    const first = buildTrainingSet([
      row({ id: "z", shown_at: same }),
      row({ id: "a", shown_at: same }),
    ]);
    const second = buildTrainingSet([
      row({ id: "a", shown_at: same }),
      row({ id: "z", shown_at: same }),
    ]);

    expect(first.map((e) => e.eventId)).toEqual(second.map((e) => e.eventId));
  });

  it("memberi reward 1 hanya untuk yang diterima", () => {
    const examples = buildTrainingSet([
      row({ id: "a", effective_action: "accepted", shown_at: "2026-08-01T05:00:00Z" }),
      row({ id: "b", effective_action: "respun", shown_at: "2026-08-02T05:00:00Z" }),
      row({ id: "c", effective_action: "ignored", shown_at: "2026-08-03T05:00:00Z" }),
      row({ id: "d", effective_action: "saved", shown_at: "2026-08-04T05:00:00Z" }),
    ]);

    expect(examples.map((e) => e.reward)).toEqual([1, 0, 0, 0]);
  });

  it("membuang baris yang labelnya belum selesai", () => {
    // Belum merespons bukan penolakan; menghitungnya sebagai nol akan menanam
    // label palsu.
    const examples = buildTrainingSet([
      row({ id: "a", effective_action: "accepted" }),
      row({ id: "b", effective_action: null }),
    ]);

    expect(examples).toHaveLength(1);
    expect(examples[0].eventId).toBe("a");
  });

  it("membawa policy_score apa adanya untuk evaluasi Fase 4", () => {
    const examples = buildTrainingSet([row({ policy_score: 0.125 })]);
    expect(examples[0].policyScore).toBe(0.125);
    expect(examples[0].policy).toBe("weighted_budget_v1");
  });
});

/**
 * Kelompok tes yang paling penting di berkas ini.
 *
 * Target leakage adalah kesalahan paling umum di proyek ML pemula, dan
 * gejalanya justru hasil evaluasi yang terlihat spektakuler. Tes di bawah
 * gagal kalau hasil sebuah baris pernah memengaruhi fiturnya sendiri, atau
 * fitur baris yang lebih awal.
 */
describe("tidak ada kebocoran masa depan", () => {
  it("fitur baris pertama tidak tahu apa-apa", () => {
    const examples = buildTrainingSet([
      row({ id: "a", shown_at: "2026-08-01T05:00:00Z", effective_action: "accepted" }),
      row({ id: "b", shown_at: "2026-08-02T05:00:00Z", effective_action: "accepted" }),
      row({ id: "c", shown_at: "2026-08-03T05:00:00Z", effective_action: "accepted" }),
    ]);

    const first = examples[0].x;
    expect(first[indexOf("afinitas_kategori")]).toBe(0);
    expect(first[indexOf("populer_accept_rate")]).toBe(0);
    expect(first[indexOf("populer_jumlah_tayang")]).toBe(0);
    expect(first[indexOf("harga_selisih_dari_kebiasaan")]).toBe(0);
  });

  it("hasil sebuah baris tidak memengaruhi fiturnya sendiri", () => {
    const diterima = buildTrainingSet([
      row({ id: "a", shown_at: "2026-08-01T05:00:00Z", effective_action: "accepted" }),
    ]);
    const ditolak = buildTrainingSet([
      row({ id: "a", shown_at: "2026-08-01T05:00:00Z", effective_action: "ignored" }),
    ]);

    // Vektornya harus identik; yang berbeda hanya labelnya.
    expect(diterima[0].x).toEqual(ditolak[0].x);
    expect(diterima[0].reward).toBe(1);
    expect(ditolak[0].reward).toBe(0);
  });

  it("mengubah hasil baris terakhir tidak mengubah fitur baris sebelumnya", () => {
    const base: RawSpinRow[] = [
      row({ id: "a", shown_at: "2026-08-01T05:00:00Z", effective_action: "ignored" }),
      row({ id: "b", shown_at: "2026-08-02T05:00:00Z", effective_action: "ignored" }),
      row({ id: "c", shown_at: "2026-08-03T05:00:00Z", effective_action: "ignored" }),
    ];

    const semuaDitolak = buildTrainingSet(base);
    const terakhirDiterima = buildTrainingSet([
      base[0],
      base[1],
      { ...base[2], effective_action: "accepted" },
    ]);

    expect(terakhirDiterima[0].x).toEqual(semuaDitolak[0].x);
    expect(terakhirDiterima[1].x).toEqual(semuaDitolak[1].x);
  });

  it("jumlah tayang tumbuh persis satu langkah di belakang", () => {
    const examples = buildTrainingSet(
      ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"].map((date, index) =>
        row({ id: `e${index}`, shown_at: `${date}T05:00:00Z` }),
      ),
    );

    // Baris ke-n hanya boleh melihat n-1 penayangan sebelumnya.
    const values = examples.map((e) => e.x[indexOf("populer_jumlah_tayang")]);
    expect(values[0]).toBe(0);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });
});

describe("statistik berjalan", () => {
  it("memisahkan riwayat antar pengguna", () => {
    const examples = buildTrainingSet([
      row({ id: "a", user_id: "user-a", shown_at: "2026-08-01T05:00:00Z" }),
      row({ id: "b", user_id: "user-b", shown_at: "2026-08-02T05:00:00Z" }),
    ]);

    // Riwayat user-a tidak boleh muncul di fitur afinitas user-b.
    expect(examples[1].x[indexOf("afinitas_kategori")]).toBe(0);
  });

  it("memisahkan riwayat antar kategori", () => {
    const examples = buildTrainingSet([
      row({ id: "a", category: "Ayam", shown_at: "2026-08-01T05:00:00Z" }),
      row({ id: "b", category: "Mie", shown_at: "2026-08-02T05:00:00Z" }),
    ]);

    expect(examples[1].x[indexOf("afinitas_kategori")]).toBe(0);
  });

  it("menyatukan riwayat dua kosakata kategori yang sama", () => {
    // Afinitas dipusatkan pada rata-rata global, jadi riwayatnya harus
    // BERBEDA dari rata-rata supaya efeknya terlihat. Ayam 1/1 diterima,
    // Mie 0/1 — global jadi 1/2, dan Ayam di atasnya.
    const examples = buildTrainingSet([
      row({
        id: "a",
        category: "Chicken restaurant",
        effective_action: "accepted",
        shown_at: "2026-08-01T05:00:00Z",
      }),
      row({
        id: "b",
        category: "Mie",
        effective_action: "ignored",
        shown_at: "2026-08-02T05:00:00Z",
      }),
      row({ id: "c", category: "Ayam", shown_at: "2026-08-03T05:00:00Z" }),
    ]);

    // "Chicken restaurant" dan "Ayam" adalah hal yang sama, jadi baris ketiga
    // mewarisi riwayat baris pertama.
    expect(examples[2].x[indexOf("afinitas_kategori")]).toBeGreaterThan(0);
  });

  it("tidak memberi dorongan saat riwayat kategorinya sama dengan rata-rata", () => {
    // Satu penayangan diterima, dan itu juga satu-satunya data global — jadi
    // kategori ini persis rata-rata, dan fiturnya nol. Ini benar, bukan bug.
    const examples = buildTrainingSet([
      row({ id: "a", category: "Ayam", shown_at: "2026-08-01T05:00:00Z" }),
      row({ id: "b", category: "Ayam", shown_at: "2026-08-02T05:00:00Z" }),
    ]);

    expect(examples[1].x[indexOf("afinitas_kategori")]).toBe(0);
  });

  it("menghitung rata-rata harga hanya dari yang diterima", () => {
    const examples = buildTrainingSet([
      row({
        id: "a",
        price_tier: 30000,
        effective_action: "ignored",
        shown_at: "2026-08-01T05:00:00Z",
      }),
      row({
        id: "b",
        price_tier: 10000,
        effective_action: "accepted",
        shown_at: "2026-08-02T05:00:00Z",
      }),
      row({
        id: "c",
        price_tier: 10000,
        effective_action: "accepted",
        shown_at: "2026-08-03T05:00:00Z",
      }),
    ]);

    // Baris ketiga membandingkan 10.000 dengan rata-rata yang diterima
    // (10.000), bukan dengan 30.000 yang ditolak. Selisihnya nol.
    expect(examples[2].x[indexOf("harga_selisih_dari_kebiasaan")]).toBe(0);
  });

  it("mengabaikan harga null saat menghitung rata-rata", () => {
    const examples = buildTrainingSet([
      row({ id: "a", price_tier: null, shown_at: "2026-08-01T05:00:00Z" }),
      row({ id: "b", price_tier: 20000, shown_at: "2026-08-02T05:00:00Z" }),
    ]);

    expect(examples.every((e) => e.x.every(Number.isFinite))).toBe(true);
  });

  it("menghasilkan vektor yang selalu terhingga untuk data campur aduk", () => {
    const messy = buildTrainingSet([
      row({ id: "a", price_tier: null, category: null, distance_km: 0 }),
      row({ id: "b", is_raining: null, distance_km: 99 }),
      row({ id: "c", effective_action: "ignored", hour_local: 0 }),
    ]);

    for (const example of messy) {
      expect(example.x).toHaveLength(26);
      expect(example.x.every(Number.isFinite)).toBe(true);
    }
  });

  it("menghasilkan larik kosong untuk masukan kosong", () => {
    expect(buildTrainingSet([])).toEqual([]);
  });
});
