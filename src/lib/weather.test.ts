import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetWeatherCache,
  currentIsRaining,
  fetchIsRaining,
  isWeatherContextEnabled,
  needsRefresh,
  refreshWeather,
} from "@/lib/weather";

const LAT = -6.9262;
const LNG = 107.7717;

function mockFetchOnce(body: unknown, ok = true) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    json: async () => body,
  } as Response);
}

describe("isWeatherContextEnabled", () => {
  afterEach(() => {
    delete process.env.ENABLE_WEATHER_CONTEXT;
  });

  it("mati secara default", () => {
    // Fitur ini memanggil layanan pihak ketiga; keputusannya ada di tangan
    // yang men-deploy, bukan menyala diam-diam saat merge.
    expect(isWeatherContextEnabled()).toBe(false);
  });

  it("hanya menyala untuk nilai 'true' yang eksplisit", () => {
    process.env.ENABLE_WEATHER_CONTEXT = "1";
    expect(isWeatherContextEnabled()).toBe(false);

    process.env.ENABLE_WEATHER_CONTEXT = "true";
    expect(isWeatherContextEnabled()).toBe(true);
  });
});

describe("fetchIsRaining", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("membaca curah hujan lebih dari nol sebagai hujan", async () => {
    mockFetchOnce({ current: { precipitation: 0.4 } });
    await expect(fetchIsRaining(LAT, LNG)).resolves.toBe(true);
  });

  it("membaca nol sebagai tidak hujan", async () => {
    mockFetchOnce({ current: { precipitation: 0 } });
    await expect(fetchIsRaining(LAT, LNG)).resolves.toBe(false);
  });

  it("membulatkan koordinat sebelum mengirimnya keluar", async () => {
    const spy = mockFetchOnce({ current: { precipitation: 0 } });
    await fetchIsRaining(LAT, LNG);

    // Lokasi persis pengguna tidak boleh sampai ke pihak ketiga.
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("latitude=-6.9");
    expect(url).toContain("longitude=107.8");
    expect(url).not.toContain("6.9262");
  });

  it.each([
    ["bentuk tak dikenal", { cuaca: "cerah" }],
    ["precipitation bukan angka", { current: { precipitation: "banyak" } }],
    ["precipitation hilang", { current: {} }],
  ])("mengembalikan null untuk %s", async (_label, body) => {
    // Menebak nol akan menanam fitur palsu ke dalam data latih.
    mockFetchOnce(body);
    await expect(fetchIsRaining(LAT, LNG)).resolves.toBeNull();
  });

  it("mengembalikan null saat responsnya bukan 2xx", async () => {
    mockFetchOnce({}, false);
    await expect(fetchIsRaining(LAT, LNG)).resolves.toBeNull();
  });
});

describe("cache cuaca", () => {
  beforeEach(() => {
    __resetWeatherCache();
    process.env.ENABLE_WEATHER_CONTEXT = "true";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.ENABLE_WEATHER_CONTEXT;
  });

  it("mengembalikan null saat cache-nya masih dingin", () => {
    // Bukan menunggu jaringan: spin tidak boleh melambat demi satu boolean.
    expect(currentIsRaining(LAT, LNG)).toBeNull();
    expect(needsRefresh(LAT, LNG)).toBe(true);
  });

  it("menyajikan nilai yang sudah disegarkan", async () => {
    mockFetchOnce({ current: { precipitation: 1.2 } });
    await refreshWeather(LAT, LNG);

    expect(currentIsRaining(LAT, LNG)).toBe(true);
    expect(needsRefresh(LAT, LNG)).toBe(false);
  });

  it("berbagi cache untuk titik yang berdekatan", async () => {
    mockFetchOnce({ current: { precipitation: 0 } });
    await refreshWeather(LAT, LNG);

    // Seluruh Jatinangor jatuh ke kunci yang sama; cuaca tidak berbeda antar-RW.
    expect(currentIsRaining(-6.93, 107.775)).toBe(false);
  });

  it("kedaluwarsa setelah 10 menit", async () => {
    vi.setSystemTime(0);
    mockFetchOnce({ current: { precipitation: 0 } });
    await refreshWeather(LAT, LNG);
    expect(currentIsRaining(LAT, LNG)).toBe(false);

    vi.setSystemTime(10 * 60 * 1000 + 1);
    expect(currentIsRaining(LAT, LNG)).toBeNull();
    expect(needsRefresh(LAT, LNG)).toBe(true);
  });

  it("menyimpan kegagalan supaya tidak dicoba ulang tiap spin", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await refreshWeather(LAT, LNG);

    expect(currentIsRaining(LAT, LNG)).toBeNull();
    expect(needsRefresh(LAT, LNG)).toBe(false);
  });

  it("tidak melempar saat jaringannya gagal", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    // Dipanggil tanpa ditunggu di route handler; rejection yang lolos bisa
    // menjatuhkan proses Node.
    await expect(refreshWeather(LAT, LNG)).resolves.toBeUndefined();
  });

  it("hanya satu permintaan per kunci walau dipanggil berbarengan", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => ({ current: { precipitation: 0 } }),
              } as Response),
            50,
          ),
        ),
    );

    const all = Promise.all([
      refreshWeather(LAT, LNG),
      refreshWeather(LAT, LNG),
      refreshWeather(LAT, LNG),
    ]);

    await vi.advanceTimersByTimeAsync(60);
    await all;

    // Lonjakan spin jam makan siang tidak boleh jadi lonjakan permintaan ke
    // layanan gratis orang lain.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("tidak menyentuh jaringan sama sekali saat fiturnya mati", () => {
    delete process.env.ENABLE_WEATHER_CONTEXT;

    expect(currentIsRaining(LAT, LNG)).toBeNull();
    expect(needsRefresh(LAT, LNG)).toBe(false);
  });
});
