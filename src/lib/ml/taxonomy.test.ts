import { describe, expect, it } from "vitest";

import {
  CUISINE_SLOTS,
  isMealtime,
  toCuisineSlot,
  toPriceLevel,
} from "@/lib/ml/taxonomy";

describe("toCuisineSlot", () => {
  it.each([
    ["Chicken restaurant", "ayam"],
    ["Ayam", "ayam"],
    ["Ayam Geprek", "ayam"],
    ["Noodle shop", "mie"],
    ["Ramen restaurant", "mie"],
    ["Mie", "mie"],
    ["Sundanese restaurant", "sunda"],
    ["Sunda", "sunda"],
    ["Padang", "padang"],
    ["Chinese restaurant", "chinese"],
    ["Dumpling restaurant", "chinese"],
    ["Japanese", "jepang_korea"],
    ["Western restaurant", "barat"],
    ["Pizza restaurant", "barat"],
    ["Fast food restaurant", "barat"],
    ["Seafood", "seafood"],
    ["Coffee shop", "kopi_minuman"],
    ["Kopi", "kopi_minuman"],
    ["Bakery", "manis_roti"],
    ["Javanese restaurant", "nusantara"],
    ["Buffet restaurant", "nusantara"],
  ])("memetakan %s ke %s", (category, expected) => {
    expect(toCuisineSlot(category)).toBe(expected);
  });

  it("mencocokkan yang spesifik lebih dulu", () => {
    // "Chicken restaurant" mengandung "restaurant", tapi yang menentukan
    // adalah "chicken".
    expect(toCuisineSlot("Chicken restaurant")).toBe("ayam");
    expect(toCuisineSlot("Seafood restaurant")).toBe("seafood");
  });

  it("tidak peduli huruf besar-kecil dan spasi berlebih", () => {
    expect(toCuisineSlot("  SUNDANESE Restaurant  ")).toBe("sunda");
  });

  it.each([null, undefined, "", "   ", "Restaurant", "Entah apa"])(
    "menaruh %s di slot lainnya",
    (category) => {
      expect(toCuisineSlot(category as string | null)).toBe("lainnya");
    },
  );

  it("selalu mengembalikan slot yang ada di daftar", () => {
    const samples = ["Ayam", "Restaurant", null, "Pizza", "xyz"];
    for (const sample of samples) {
      expect(CUISINE_SLOTS).toContain(toCuisineSlot(sample));
    }
  });
});

describe("toPriceLevel", () => {
  it.each([
    [8000, 1],
    [10000, 1],
    [15000, 2],
    [20000, 2],
    [30000, 3],
    [35000, 3],
    [50000, 4],
  ])("memetakan Rp%i ke tingkat %i", (rupiah, level) => {
    expect(toPriceLevel(rupiah)).toBe(level);
  });

  it.each([null, undefined, 0, -1000, Number.NaN, Number.POSITIVE_INFINITY])(
    "mengembalikan null untuk %s",
    (value) => {
      // Belum dikurasi harus tetap null sampai ke fitur, bukan ditebak.
      expect(toPriceLevel(value as number | null)).toBeNull();
    },
  );
});

describe("isMealtime", () => {
  it.each([7, 12, 13, 18])("menandai jam %i sebagai jam makan", (hour) => {
    expect(isMealtime(hour)).toBe(true);
  });

  it.each([3, 10, 15, 22])("menandai jam %i sebagai bukan jam makan", (hour) => {
    expect(isMealtime(hour)).toBe(false);
  });

  it("memakai batas atas yang eksklusif", () => {
    expect(isMealtime(14)).toBe(false);
    expect(isMealtime(11)).toBe(true);
  });
});
