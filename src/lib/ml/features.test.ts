import { describe, expect, it } from "vitest";

import {
  ablateBlock,
  buildFeatureVector,
  FEATURE_BLOCKS,
  FEATURE_DIM,
  FEATURE_NAMES,
  type FeatureInput,
} from "@/lib/ml/features";
import { CUISINE_SLOTS } from "@/lib/ml/taxonomy";

const NONE = { impressions: 0, accepts: 0 };

function makeInput(overrides: Partial<FeatureInput> = {}): FeatureInput {
  return {
    distanceKm: 0.5,
    priceTier: 15000,
    category: "Chicken restaurant",
    hourLocal: 12,
    dayOfWeek: 3,
    isRaining: false,
    userCategoryStats: NONE,
    userPriceStats: NONE,
    restaurantStats: NONE,
    userMeanAcceptedPrice: null,
    globalAcceptRate: 0.2,
    ...overrides,
  };
}

const indexOf = (name: string) => FEATURE_NAMES.indexOf(name);

describe("bentuk vektor", () => {
  it("selalu 26 dimensi", () => {
    expect(buildFeatureVector(makeInput())).toHaveLength(FEATURE_DIM);
    expect(FEATURE_NAMES).toHaveLength(FEATURE_DIM);
  });

  it("blok fiturnya menutupi seluruh vektor tanpa tumpang tindih", () => {
    // Kalau ini bergeser, ablasi di Fase 2 akan menolkan dimensi yang salah
    // dan kesimpulannya ikut salah tanpa ada yang error.
    let cursor = 0;
    for (const block of FEATURE_BLOCKS) {
      expect(block.start).toBe(cursor);
      expect(block.end).toBeGreaterThan(block.start);
      cursor = block.end;
    }
    expect(cursor).toBe(FEATURE_DIM);
  });

  it("menjaga nilainya di rentang yang sebanding", () => {
    // Satu dimensi yang skalanya jauh lebih besar akan menelan regularisasi
    // dimensi lain.
    const extremes = [
      makeInput({ distanceKm: 0 }),
      makeInput({ distanceKm: 50 }),
      makeInput({ priceTier: 200_000, userMeanAcceptedPrice: 5_000 }),
      makeInput({ restaurantStats: { impressions: 100_000, accepts: 90_000 } }),
    ];

    for (const input of extremes) {
      for (const value of buildFeatureVector(input)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value)).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it("murni: masukan yang sama selalu memberi keluaran yang sama", () => {
    const input = makeInput();
    expect(buildFeatureVector(input)).toEqual(buildFeatureVector(input));
  });
});

describe("blok jarak", () => {
  it("menurun seiring jarak bertambah", () => {
    const dekat = buildFeatureVector(makeInput({ distanceKm: 0.1 }));
    const jauh = buildFeatureVector(makeInput({ distanceKm: 3 }));

    expect(dekat[0]).toBeGreaterThan(jauh[0]);
    expect(dekat[1]).toBeGreaterThan(jauh[1]);
  });

  it("bertahan terhadap jarak yang tidak masuk akal", () => {
    for (const distanceKm of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const x = buildFeatureVector(makeInput({ distanceKm }));
      expect(x.every(Number.isFinite)).toBe(true);
    }
  });
});

describe("blok harga", () => {
  it("memetakan rupiah ke tingkat harga", () => {
    const murah = buildFeatureVector(makeInput({ priceTier: 8000 }));
    const mahal = buildFeatureVector(makeInput({ priceTier: 50000 }));

    expect(murah[indexOf("harga_level")]).toBeCloseTo(0.25);
    expect(mahal[indexOf("harga_level")]).toBeCloseTo(1);
  });

  it("memakai nol untuk harga yang belum dikurasi", () => {
    // Belum tahu, bukan "murah". Menebak tingkat 2 akan menanam fitur palsu.
    const x = buildFeatureVector(makeInput({ priceTier: null }));
    expect(x[indexOf("harga_level")]).toBe(0);
    expect(x[indexOf("harga_selisih_dari_kebiasaan")]).toBe(0);
  });

  it("mengukur selisih dari kebiasaan belanja user", () => {
    const lebihMahal = buildFeatureVector(
      makeInput({ priceTier: 30000, userMeanAcceptedPrice: 12000 }),
    );
    const lebihMurah = buildFeatureVector(
      makeInput({ priceTier: 8000, userMeanAcceptedPrice: 25000 }),
    );

    expect(lebihMahal[indexOf("harga_selisih_dari_kebiasaan")]).toBeGreaterThan(0);
    expect(lebihMurah[indexOf("harga_selisih_dari_kebiasaan")]).toBeLessThan(0);
  });

  it("netral saat user belum pernah menerima apa pun", () => {
    const x = buildFeatureVector(makeInput({ userMeanAcceptedPrice: null }));
    expect(x[indexOf("harga_selisih_dari_kebiasaan")]).toBe(0);
  });
});

describe("blok masakan", () => {
  it("menyalakan tepat satu slot", () => {
    const x = buildFeatureVector(makeInput());
    const block = x.slice(4, 16);

    expect(block.filter((value) => value === 1)).toHaveLength(1);
    expect(block.reduce((sum, value) => sum + value, 0)).toBe(1);
  });

  it("menyatukan dua kosakata kategori ke slot yang sama", () => {
    // Data seed berbahasa Inggris, ingest OSM berbahasa Indonesia. Model tidak
    // boleh melihat keduanya sebagai hal yang berbeda.
    const inggris = buildFeatureVector(makeInput({ category: "Chicken restaurant" }));
    const indonesia = buildFeatureVector(makeInput({ category: "Ayam" }));

    expect(inggris.slice(4, 16)).toEqual(indonesia.slice(4, 16));
  });

  it("menaruh kategori tak dikenal dan null di slot lainnya", () => {
    const lainnyaIndex = 4 + CUISINE_SLOTS.indexOf("lainnya");

    for (const category of [null, "", "Restaurant", "Entah apa"]) {
      const x = buildFeatureVector(makeInput({ category }));
      expect(x[lainnyaIndex]).toBe(1);
    }
  });
});

describe("blok waktu", () => {
  it("membuat jam melingkar", () => {
    // Jam 23 dan jam 0 harus berdekatan. Kalau jam dipakai apa adanya sebagai
    // 0-23, tengah malam jadi sejauh mungkin dari jam 11 malam.
    const jam23 = buildFeatureVector(makeInput({ hourLocal: 23 }));
    const jam0 = buildFeatureVector(makeInput({ hourLocal: 0 }));
    const jam12 = buildFeatureVector(makeInput({ hourLocal: 12 }));

    const jarak = (a: number[], b: number[]) =>
      Math.hypot(a[16] - b[16], a[17] - b[17]);

    expect(jarak(jam23, jam0)).toBeLessThan(jarak(jam23, jam12));
  });

  it("menandai akhir pekan", () => {
    expect(buildFeatureVector(makeInput({ dayOfWeek: 0 }))[18]).toBe(1);
    expect(buildFeatureVector(makeInput({ dayOfWeek: 6 }))[18]).toBe(1);
    expect(buildFeatureVector(makeInput({ dayOfWeek: 3 }))[18]).toBe(0);
  });

  it("menandai jam makan", () => {
    expect(buildFeatureVector(makeInput({ hourLocal: 12 }))[19]).toBe(1);
    expect(buildFeatureVector(makeInput({ hourLocal: 7 }))[19]).toBe(1);
    expect(buildFeatureVector(makeInput({ hourLocal: 15 }))[19]).toBe(0);
  });
});

describe("blok cuaca", () => {
  it("membedakan tidak tahu dari tidak hujan", () => {
    // Ini alasan blok ini memakai -1/0/+1 dan bukan 0/1.
    const hujan = buildFeatureVector(makeInput({ isRaining: true }));
    const kering = buildFeatureVector(makeInput({ isRaining: false }));
    const tidakTahu = buildFeatureVector(makeInput({ isRaining: null }));

    expect(hujan[20]).toBe(1);
    expect(kering[20]).toBe(-1);
    expect(tidakTahu[20]).toBe(0);
  });
});

describe("afinitas dan popularitas", () => {
  it("nol saat belum ada riwayat", () => {
    // Dipusatkan supaya "belum tahu" tidak mendorong ke arah mana pun.
    const x = buildFeatureVector(makeInput());
    expect(x[indexOf("afinitas_kategori")]).toBe(0);
    expect(x[indexOf("populer_accept_rate")]).toBe(0);
  });

  it("menghaluskan bukti yang masih tipis", () => {
    // Satu penayangan yang diterima tidak boleh terlihat sempurna.
    const tipis = buildFeatureVector(
      makeInput({ restaurantStats: { impressions: 1, accepts: 1 } }),
    );
    const tebal = buildFeatureVector(
      makeInput({ restaurantStats: { impressions: 100, accepts: 100 } }),
    );

    expect(tipis[indexOf("populer_accept_rate")]).toBeGreaterThan(0);
    expect(tipis[indexOf("populer_accept_rate")]).toBeLessThan(
      tebal[indexOf("populer_accept_rate")] / 2,
    );
  });

  it("memberi tanda negatif untuk yang di bawah rata-rata", () => {
    const buruk = buildFeatureVector(
      makeInput({
        globalAcceptRate: 0.5,
        userCategoryStats: { impressions: 50, accepts: 2 },
      }),
    );

    expect(buruk[indexOf("afinitas_kategori")]).toBeLessThan(0);
  });

  it("naik seiring jumlah tayang, dan tidak meledak", () => {
    const jarang = buildFeatureVector(
      makeInput({ restaurantStats: { impressions: 3, accepts: 1 } }),
    );
    const sering = buildFeatureVector(
      makeInput({ restaurantStats: { impressions: 900, accepts: 300 } }),
    );

    expect(sering[indexOf("populer_jumlah_tayang")]).toBeGreaterThan(
      jarang[indexOf("populer_jumlah_tayang")],
    );
    expect(sering[indexOf("populer_jumlah_tayang")]).toBeLessThanOrEqual(1);
  });

  it("bertahan terhadap hitungan yang tidak konsisten", () => {
    // accepts lebih banyak dari impressions tidak mungkin terjadi, tapi data
    // rusak tidak boleh menghasilkan NaN yang menyebar ke seluruh model.
    const x = buildFeatureVector(
      makeInput({ restaurantStats: { impressions: 2, accepts: 10 } }),
    );
    expect(x.every(Number.isFinite)).toBe(true);
  });
});

describe("ablateBlock", () => {
  it("menolkan tepat satu blok", () => {
    const x = buildFeatureVector(makeInput());
    const tanpaMasakan = ablateBlock(x, "masakan");

    expect(tanpaMasakan.slice(4, 16).every((value) => value === 0)).toBe(true);
    expect(tanpaMasakan.slice(0, 4)).toEqual(x.slice(0, 4));
    expect(tanpaMasakan.slice(16)).toEqual(x.slice(16));
  });

  it("tidak mengubah vektor aslinya", () => {
    const x = buildFeatureVector(makeInput());
    const salinan = [...x];
    ablateBlock(x, "bias");
    expect(x).toEqual(salinan);
  });

  it("menolak nama blok yang tidak dikenal", () => {
    expect(() => ablateBlock(buildFeatureVector(makeInput()), "warna")).toThrow(
      /tidak dikenal/,
    );
  });
});
