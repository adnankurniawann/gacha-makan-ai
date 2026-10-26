import { describe, expect, it } from "vitest";

import {
  epsilonGreedyPolicy,
  linUcbPolicy,
  nearestPolicy,
  thompsonSamplingPolicy,
  uniformRandomPolicy,
} from "@/lib/ml/bandit";
import { FEATURE_DIM } from "@/lib/ml/features";
import { createRng } from "@/lib/ml/linalg";
import {
  DEFAULT_CONFIG,
  generateRestaurants,
  generateUserThetas,
  runAll,
  type PolicyResult,
  type SimulationConfig,
} from "@/lib/ml/simulator";

/** Lebih pendek dari DEFAULT_CONFIG supaya suite-nya tetap cepat. */
const CONFIG: SimulationConfig = {
  ...DEFAULT_CONFIG,
  rounds: 1500,
  seed: 20260804,
};

function buildPolicies(config: SimulationConfig = CONFIG) {
  return [
    uniformRandomPolicy(config.seed + 1),
    nearestPolicy(),
    epsilonGreedyPolicy(FEATURE_DIM, config.seed + 2, 0.1),
    linUcbPolicy(FEATURE_DIM, 0.5),
    thompsonSamplingPolicy(FEATURE_DIM, config.seed + 3),
  ];
}

function byName(results: PolicyResult[], prefix: string): PolicyResult {
  const found = results.find((result) => result.name.startsWith(prefix));
  if (!found) throw new Error(`Kebijakan "${prefix}" tidak ada di hasil.`);
  return found;
}

describe("lingkungan simulasi", () => {
  it("menghasilkan katalog dengan sepertiga tanpa kategori berarti", () => {
    // Mencerminkan data seed yang sebenarnya, di mana "Restaurant" polos
    // adalah nilai paling umum. Katalog yang lebih rapi dari kenyataan akan
    // melebih-lebihkan manfaat modelnya.
    const restaurants = generateRestaurants(400, createRng(1));
    const plain = restaurants.filter((r) => r.category === "Restaurant").length;

    expect(plain / restaurants.length).toBeGreaterThan(0.25);
    expect(plain / restaurants.length).toBeLessThan(0.42);
  });

  it("memberi semua pengguna preferensi jarak yang positif", () => {
    const thetas = generateUserThetas(50, createRng(2));
    for (const theta of thetas) {
      expect(theta).toHaveLength(FEATURE_DIM);
      expect(theta[0]).toBeGreaterThan(0);
      expect(theta[1]).toBeGreaterThan(0);
    }
  });

  it("menempatkan accept rate dasar di rentang yang wajar", () => {
    // Kalau uniform random sudah menerima 80%, tidak ada kebijakan yang bisa
    // dibedakan dan seluruh perbandingannya jadi tidak berarti.
    const { results } = runAll([uniformRandomPolicy(1)], CONFIG);
    expect(results[0].acceptRate).toBeGreaterThan(0.1);
    expect(results[0].acceptRate).toBeLessThan(0.5);
  });

  it("berulang persis untuk benih yang sama", () => {
    // Sengaja jauh lebih pendek dari CONFIG: determinisme terbukti sama
    // kuatnya dengan 300 ronde, dan menjalankan sepuluh simulasi penuh cuma
    // untuk ini membuat seluruh suite lambat tanpa menambah keyakinan.
    const quick: SimulationConfig = { ...CONFIG, rounds: 300 };
    const policies = () => [
      uniformRandomPolicy(quick.seed + 1),
      thompsonSamplingPolicy(FEATURE_DIM, quick.seed + 3),
    ];

    const first = runAll(policies(), quick);
    const second = runAll(policies(), quick);

    expect(first.results.map((r) => r.cumulativeRegret)).toEqual(
      second.results.map((r) => r.cumulativeRegret),
    );
  });

  it("batas atasnya hanya bergeser sedikit antar kebijakan", () => {
    // Tidak identik, dan itu bukan bug: fitur popularitas dan afinitas
    // bergantung pada apa yang pernah ditayangkan, jadi kebijakan yang memilih
    // berbeda perlahan menggeser lingkungannya sendiri — persis seperti sistem
    // sungguhan. Yang harus dijaga adalah pergeserannya tetap kecil, supaya
    // perbandingan regret antar kebijakan tetap bermakna.
    const { results } = runAll(buildPolicies(), CONFIG);
    const rates = results.map((r) => r.oracleAcceptRate);

    // Terukur ~3 poin persen pada konfigurasi ini. Ambangnya sengaja dipasang
    // sedikit di atas itu supaya perubahan yang membuatnya melonjak akan
    // ketahuan, bukan supaya angkanya "lulus".
    expect(Math.max(...rates) - Math.min(...rates)).toBeLessThan(0.05);
  });
});

describe("perbandingan kebijakan", () => {
  const { results, oracleAcceptRate } = runAll(buildPolicies(), CONFIG);

  const uniform = byName(results, "uniform_random");
  const nearest = byName(results, "jarak_terdekat");
  const thompson = byName(results, "thompson_sampling");
  const linucb = byName(results, "linucb");
  const greedy = byName(results, "epsilon_greedy");

  it("mencetak tabel hasil", () => {
    // Angka-angka inilah yang jadi isi laporan. Dicetak dari test supaya ia
    // selalu berasal dari kode yang benar-benar dijalankan, bukan dari catatan
    // manual yang bisa basi tanpa ada yang sadar.
    const rows = [...results]
      .sort((a, b) => a.cumulativeRegret - b.cumulativeRegret)
      .map((result) =>
        [
          result.name.padEnd(22),
          `accept ${(result.acceptRate * 100).toFixed(1)}%`.padEnd(14),
          `regret ${result.cumulativeRegret.toFixed(1)}`.padEnd(16),
          `coverage ${(result.coverage * 100).toFixed(0)}%`,
        ].join(" "),
      );

    console.log(
      [
        `\nSimulasi: ${CONFIG.rounds} ronde, ${CONFIG.users} pengguna, ` +
          `${CONFIG.restaurants} restoran, benih ${CONFIG.seed}`,
        `oracle (batas atas)     accept ${(oracleAcceptRate * 100).toFixed(1)}%`,
        ...rows,
        "",
      ].join("\n"),
    );

    expect(rows).toHaveLength(5);
  });

  it("oracle tidak bisa dikalahkan siapa pun", () => {
    for (const result of results) {
      expect(result.acceptRate).toBeLessThanOrEqual(oracleAcceptRate + 1e-9);
      expect(result.cumulativeRegret).toBeGreaterThanOrEqual(0);
    }
  });

  it("Thompson Sampling mengalahkan acak seragam", () => {
    // Ini klaim utamanya, dan satu-satunya yang benar-benar harus dibuktikan:
    // kebijakan yang sekarang dipakai aplikasi adalah acak, dan model hanya
    // layak dipasang kalau ia mengalahkannya.
    expect(thompson.cumulativeRegret).toBeLessThan(uniform.cumulativeRegret);
    expect(thompson.acceptRate).toBeGreaterThan(uniform.acceptRate);
  });

  it("Thompson Sampling mengalahkan baseline jarak terdekat", () => {
    // Baseline non-ML yang sering mengejutkan kuat. Kalau model tidak bisa
    // mengalahkan ini, ia belum layak dipasang.
    expect(thompson.cumulativeRegret).toBeLessThan(nearest.cumulativeRegret);
  });

  it("bandit kontekstual mengalahkan epsilon-greedy", () => {
    expect(thompson.cumulativeRegret).toBeLessThan(greedy.cumulativeRegret);
    expect(linucb.cumulativeRegret).toBeLessThan(greedy.cumulativeRegret);
  });

  it("kurva belajarnya naik, bukan datar", () => {
    const curve = thompson.learningCurve;
    const awal = curve.slice(0, 3).reduce((sum, v) => sum + v, 0) / 3;
    const akhir = curve.slice(-3).reduce((sum, v) => sum + v, 0) / 3;

    expect(akhir).toBeGreaterThan(awal);
  });

  it("tidak runtuh jadi merekomendasikan segelintir tempat saja", () => {
    // Sistem yang cuma merekomendasikan lima tempat teratas itu gagal sebagai
    // produk, walau accept rate-nya tinggi.
    expect(thompson.coverage).toBeGreaterThan(0.3);
  });

  it("jarak terdekat memang menutup katalog paling sempit", () => {
    // Kebijakan deterministik tanpa eksplorasi: ia hanya pernah menampilkan
    // tempat-tempat yang kebetulan paling dekat.
    expect(nearest.coverage).toBeLessThan(thompson.coverage);
  });
});

describe("ablasi", () => {
  const run = (ablate?: string) =>
    runAll([thompsonSamplingPolicy(FEATURE_DIM, CONFIG.seed + 3)], {
      ...CONFIG,
      ablate,
    }).results[0];

  it("membuang blok jarak menaikkan regret", () => {
    // Semua pengguna sintetis punya bobot jarak positif, jadi kalau membuang
    // blok ini TIDAK merugikan, berarti ada yang salah di jalur fiturnya.
    const penuh = run();
    const tanpaJarak = run("jarak");

    expect(tanpaJarak.cumulativeRegret).toBeGreaterThan(penuh.cumulativeRegret);
  });

  it("membuang bias tidak menghancurkan model", () => {
    // Bias menggeser seluruh skor dengan konstanta yang sama, jadi ia tidak
    // mengubah urutan kandidat dalam satu ronde.
    const penuh = run();
    const tanpaBias = run("bias");

    expect(tanpaBias.cumulativeRegret).toBeLessThan(penuh.cumulativeRegret * 2);
  });

  it("menolak nama blok yang tidak dikenal", () => {
    expect(() => run("warna")).toThrow(/tidak dikenal/);
  });
});
