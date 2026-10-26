import { describe, expect, it } from "vitest";

import {
  buildDataset,
  goldSlot,
  GOLD_MAP,
  normalizeEvalName,
  sampleBalanced,
  type EvalItem,
  type OsmSnapshot,
} from "@/lib/ml/eval/dataset";
import { CUISINE_SLOTS } from "@/lib/ml/taxonomy";

function snapshot(places: Array<[string, string, string]>): OsmSnapshot {
  return {
    source: "",
    license: "",
    osmBase: "",
    query: "",
    places: places.map(([osm, name, cuisine]) => ({ osm, name, cuisine, amenity: "restaurant" })),
  };
}

describe("goldSlot", () => {
  it("memetakan nilai tunggal lewat pedoman", () => {
    expect(goldSlot("chicken")).toEqual({ slot: "ayam" });
    expect(goldSlot("Coffee_Shop")).toEqual({ slot: "kopi_minuman" });
    expect(goldSlot("thai")).toEqual({ slot: "lainnya" });
  });

  it("mengabaikan nilai umum, tapi membuang kalau hanya itu isinya", () => {
    expect(goldSlot("asian;sushi")).toEqual({ slot: "jepang_korea" });
    expect(goldSlot("local;breakfast")).toEqual({ drop: "hanya_umum" });
  });

  it("membuang nilai yang tidak ada di pedoman", () => {
    expect(goldSlot("chicken;zzz")).toEqual({ drop: "tidak_dipetakan" });
  });

  it("nusantara kalah dari satu slot spesifik, tapi dua slot spesifik dibuang", () => {
    expect(goldSlot("indonesian;sundanese")).toEqual({ slot: "sunda" });
    expect(goldSlot("chicken;burger")).toEqual({ drop: "multi_slot" });
    expect(goldSlot("indonesian;chicken;burger")).toEqual({ drop: "multi_slot" });
  });

  it("hanya memakai slot yang ada", () => {
    for (const slot of Object.values(GOLD_MAP)) {
      if (slot !== null) expect(CUISINE_SLOTS).toContain(slot);
    }
  });
});

describe("normalizeEvalName", () => {
  it("menyamakan huruf, diakritik, dan tanda baca", () => {
    expect(normalizeEvalName("McDonald's")).toBe("mcdonalds");
    expect(normalizeEvalName("  Café  Ñam-Ñam ")).toBe("cafe nam nam");
  });
});

describe("buildDataset", () => {
  it("satu item per nama, label mayoritas, dan tanda jaringan waralaba", () => {
    const { items, stats } = buildDataset(
      snapshot([
        ["n1", "KFC", "chicken"],
        ["n2", "kfc", "chicken"],
        ["n3", "K.F.C.", "fried_chicken"],
        ["n4", "Bakso Pak Kumis", "bakso"],
        ["n5", "Warung Ambigu", "chicken"],
        ["n6", "warung ambigu", "pizza"],
        ["n7", "Kedai X", "local"],
      ]),
      { chainMin: 2 },
    );

    const kfc = items.find((item) => item.name === "KFC");
    expect(kfc).toMatchObject({ id: "n1", gold: "ayam", chain: true });
    // "K.F.C." menjadi "k f c", nama yang berbeda.
    expect(items.filter((item) => item.gold === "ayam")).toHaveLength(2);
    expect(items.find((item) => item.name === "Bakso Pak Kumis")).toMatchObject({
      gold: "mie",
      chain: false,
      hard: false,
    });
    expect(items.some((item) => item.name.toLowerCase() === "warung ambigu")).toBe(false);
    expect(stats.dropped.label_bertentangan).toBe(2);
    expect(stats.dropped.hanya_umum).toBe(1);
  });

  it("split ditentukan nama, jadi stabil walau snapshot bertambah", () => {
    const base: Array<[string, string, string]> = Array.from({ length: 200 }, (_, i) => [
      `n${i}`,
      `Warung ${i}`,
      "indonesian",
    ]);
    const before = buildDataset(snapshot(base)).items;
    const after = buildDataset(snapshot([...base, ["n999", "Tambahan", "pizza"]])).items;
    const splitOf = (items: EvalItem[]) => new Map(items.map((i) => [i.name, i.split]));
    const a = splitOf(before);
    const b = splitOf(after);
    for (const [name, split] of a) expect(b.get(name)).toBe(split);

    const counts = { train: 0, dev: 0, test: 0 };
    for (const item of before) counts[item.split] += 1;
    expect(counts.train).toBeGreaterThan(counts.test);
    expect(counts.test).toBeGreaterThan(0);
  });
});

describe("sampleBalanced", () => {
  it("membatasi tiap kelas dan deterministik", () => {
    const items: EvalItem[] = Array.from({ length: 50 }, (_, i) => ({
      id: `n${i}`,
      name: `x${i}`,
      gold: i < 40 ? "nusantara" : "padang",
      split: "test",
      chain: false,
      hard: true,
    }));
    const sample = sampleBalanced(items, 5, 1);
    expect(sample.filter((i) => i.gold === "nusantara")).toHaveLength(5);
    expect(sample.filter((i) => i.gold === "padang")).toHaveLength(5);
    expect(sampleBalanced(items, 5, 1)).toEqual(sample);
  });
});
