import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AREA_PRESETS,
  clearSavedLocation,
  describeLocation,
  findArea,
  readPermissionState,
  readSavedLocation,
  saveLocation,
} from "@/lib/location";

describe("readSavedLocation", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("mengembalikan null saat belum ada pilihan", () => {
    expect(readSavedLocation()).toBeNull();
  });

  it("mengembalikan pilihan yang tersimpan utuh", () => {
    saveLocation({ source: "area", lat: -6.93, lng: 107.77, areaId: "sayang" });

    expect(readSavedLocation()).toEqual({
      source: "area",
      lat: -6.93,
      lng: 107.77,
      areaId: "sayang",
    });
  });

  it.each([
    ["bukan JSON", "{{{"],
    ["JSON tapi bukan objek", '"halo"'],
    ["source tidak dikenal", '{"source":"tebak","lat":-6.9,"lng":107.7}'],
    ["koordinat hilang", '{"source":"gps"}'],
    ["latitude di luar rentang", '{"source":"gps","lat":95,"lng":107.7}'],
    ["longitude di luar rentang", '{"source":"gps","lat":-6.9,"lng":999}'],
    ["koordinat bukan angka", '{"source":"gps","lat":"-6.9","lng":"107.7"}'],
  ])("memperlakukan %s sebagai belum ada pilihan", (_label, stored) => {
    // Lebih baik bertanya sekali lagi daripada mengirim koordinat ngawur
    // ke pencarian.
    window.localStorage.setItem("gacha-makan:lokasi", stored);
    expect(readSavedLocation()).toBeNull();
  });

  it("tidak melempar saat localStorage diblokir", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("akses ditolak");
      });

    expect(readSavedLocation()).toBeNull();
    getItem.mockRestore();
  });
});

describe("saveLocation", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("tidak melempar saat kuota penuh", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("kuota habis");
      });

    expect(() =>
      saveLocation({ source: "gps", lat: -6.93, lng: 107.77 }),
    ).not.toThrow();
    setItem.mockRestore();
  });

  it("bisa dihapus lagi", () => {
    saveLocation({ source: "gps", lat: -6.93, lng: 107.77 });
    clearSavedLocation();
    expect(readSavedLocation()).toBeNull();
  });
});

describe("findArea dan describeLocation", () => {
  it("menemukan preset yang ada", () => {
    expect(findArea("kampus")?.label).toBe("Kampus");
  });

  it("mengembalikan null untuk id yang tidak dikenal", () => {
    expect(findArea("mars")).toBeNull();
    expect(findArea(undefined)).toBeNull();
  });

  it("memberi label yang bisa dibaca untuk tiap keadaan", () => {
    expect(describeLocation(null)).toBe("Belum dipilih");
    expect(describeLocation({ source: "gps", lat: 0, lng: 0 })).toBe(
      "Lokasi kamu sekarang",
    );
    expect(
      describeLocation({ source: "area", lat: 0, lng: 0, areaId: "sayang" }),
    ).toBe("Sayang");
    // Area yang sudah dihapus dari daftar tidak boleh membuat UI kosong.
    expect(
      describeLocation({ source: "area", lat: 0, lng: 0, areaId: "hilang" }),
    ).toBe("Area pilihan");
  });
});

describe("AREA_PRESETS", () => {
  it("semua koordinatnya masuk akal untuk Jatinangor", () => {
    for (const area of AREA_PRESETS) {
      expect(area.lat).toBeGreaterThan(-7.0);
      expect(area.lat).toBeLessThan(-6.8);
      expect(area.lng).toBeGreaterThan(107.6);
      expect(area.lng).toBeLessThan(107.9);
    }
  });

  it("tidak punya id ganda", () => {
    const ids = AREA_PRESETS.map((area) => area.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("readPermissionState", () => {
  const original = navigator.permissions;

  afterEach(() => {
    Object.defineProperty(navigator, "permissions", {
      value: original,
      configurable: true,
    });
  });

  it("meneruskan status dari Permissions API", async () => {
    Object.defineProperty(navigator, "permissions", {
      value: { query: vi.fn().mockResolvedValue({ state: "denied" }) },
      configurable: true,
    });

    await expect(readPermissionState()).resolves.toBe("denied");
  });

  it("menjawab unknown kalau Permissions API tidak ada", async () => {
    Object.defineProperty(navigator, "permissions", {
      value: undefined,
      configurable: true,
    });

    await expect(readPermissionState()).resolves.toBe("unknown");
  });

  it("menjawab unknown kalau query-nya melempar", async () => {
    Object.defineProperty(navigator, "permissions", {
      value: { query: vi.fn().mockRejectedValue(new Error("tidak didukung")) },
      configurable: true,
    });

    await expect(readPermissionState()).resolves.toBe("unknown");
  });
});
