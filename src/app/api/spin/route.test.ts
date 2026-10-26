import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getEligibleRestaurantsMock,
  calculateSpinWeightsMock,
  weightedRandomIndexMock,
  selectionPropensityMock,
  recordSpinEventMock,
  recordSpinMissMock,
  prepareBanditMock,
  chooseWithBanditMock,
} = vi.hoisted(() => ({
  getEligibleRestaurantsMock: vi.fn(),
  calculateSpinWeightsMock: vi.fn(),
  weightedRandomIndexMock: vi.fn(),
  selectionPropensityMock: vi.fn(),
  recordSpinEventMock: vi.fn(),
  recordSpinMissMock: vi.fn(),
  prepareBanditMock: vi.fn(),
  chooseWithBanditMock: vi.fn(),
}));

vi.mock("@/lib/supabase/queries", () => ({
  getEligibleRestaurants: getEligibleRestaurantsMock,
  supabase: {},
}));

vi.mock("@/utils/gacha", () => ({
  calculateSpinWeights: calculateSpinWeightsMock,
  weightedRandomIndex: weightedRandomIndexMock,
  selectionPropensity: selectionPropensityMock,
  SPIN_POLICY: "weighted_budget_v1",
}));

vi.mock("@/lib/weather", () => ({
  currentIsRaining: () => null,
  needsRefresh: () => false,
  refreshWeather: vi.fn(),
}));

vi.mock("@/lib/supabase/events", () => ({
  recordSpinEvent: recordSpinEventMock,
  recordSpinMiss: recordSpinMissMock,
}));

vi.mock("@/lib/ml/serve", () => ({
  prepareBandit: prepareBanditMock,
  chooseWithBandit: chooseWithBanditMock,
}));

import { POST } from "@/app/api/spin/route";
import { __resetRateLimits } from "@/lib/rate-limit";

function spinRequest(body: unknown, ip = "203.0.113.10"): Request {
  return new Request("http://localhost/api/spin", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID_BODY = {
  budget: 20000,
  radius: 1000,
  user_lat: -6.92,
  user_lng: 107.77,
};

describe("POST /api/spin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimits();
    // Nilai default supaya tiap tes tidak perlu mengulanginya.
    selectionPropensityMock.mockReturnValue(0.5);
    // Flag mati: semua tes lama berjalan di kebijakan lama.
    prepareBanditMock.mockResolvedValue(null);
  });

  it("returns the selected restaurant for a valid request", async () => {
    getEligibleRestaurantsMock.mockResolvedValue([
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Ayam Geprek",
        category: "Ayam",
        price_tier: 15000,
        hygiene_score: 90,
        distance: 123,
        is_open: true,
      },
    ]);
    calculateSpinWeightsMock.mockReturnValue([5000]);
    weightedRandomIndexMock.mockReturnValue(0);

    const response = await POST(spinRequest(VALID_BODY));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Ayam Geprek",
        category: "Ayam",
        price_tier: 15000,
        distance: 123,
        hygiene_score: 90,
        is_open: true,
      },
      // Tanpa session_id tidak ada yang dicatat, dan spin tetap berhasil.
      event_id: null,
    });
    expect(recordSpinEventMock).not.toHaveBeenCalled();
  });

  it("defaults to hiding places that are closed right now", async () => {
    getEligibleRestaurantsMock.mockResolvedValue([]);

    await POST(spinRequest(VALID_BODY));

    expect(getEligibleRestaurantsMock).toHaveBeenNthCalledWith(
      1,
      20000,
      1000,
      -6.92,
      107.77,
      true,
    );
  });

  it("passes only_open through when the caller turns the filter off", async () => {
    getEligibleRestaurantsMock.mockResolvedValue([]);

    await POST(spinRequest({ ...VALID_BODY, only_open: false }));

    expect(getEligibleRestaurantsMock).toHaveBeenNthCalledWith(
      1,
      20000,
      1000,
      -6.92,
      107.77,
      false,
    );
  });

  it("mencatat penayangan dengan konteks yang dibekukan saat itu juga", async () => {
    const candidates = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Ayam Geprek",
        category: "Ayam",
        price_tier: 15000,
        hygiene_score: 90,
        distance: 420,
        is_open: true,
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        name: "Warteg Bahari",
        category: null,
        price_tier: 12000,
        hygiene_score: 80,
        distance: 900,
        is_open: null,
      },
    ];
    getEligibleRestaurantsMock.mockResolvedValue(candidates);
    calculateSpinWeightsMock.mockReturnValue([5000, 8000]);
    weightedRandomIndexMock.mockReturnValue(0);
    recordSpinEventMock.mockResolvedValue("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    const response = await POST(
      spinRequest({
        ...VALID_BODY,
        session_id: "99999999-9999-4999-8999-999999999999",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      event_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });

    // candidate_n adalah jumlah kandidat SAAT ITU, bukan dihitung ulang nanti.
    // Kebijakannya juga harus jujur: pemilihannya berbobot, bukan seragam.
    expect(recordSpinEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "99999999-9999-4999-8999-999999999999",
        restaurantId: "11111111-1111-1111-1111-111111111111",
        userLat: -6.92,
        userLng: 107.77,
        distanceMeters: 420,
        candidateCount: 2,
        policy: "weighted_budget_v1",
        // Peluang draw ini. Tanpa angka ini, log tidak bisa dipakai untuk
        // evaluasi off-policy yang tak bias.
        policyScore: 0.5,
        // null berarti TIDAK TAHU, bukan "tidak hujan".
        isRaining: null,
        // Seluruh arm set, bukan cuma yang menang — tanpa ini evaluasi replay
        // di Fase 4 mustahil.
        candidateIds: [
          "11111111-1111-1111-1111-111111111111",
          "22222222-2222-2222-2222-222222222222",
        ],
        candidateDistancesM: [420, 900],
      }),
    );
    expect(recordSpinEventMock.mock.calls[0][0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("tetap menjawab 200 walau pencatatan gagal", async () => {
    const candidate = {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Ayam Geprek",
      category: "Ayam",
      price_tier: 15000,
      hygiene_score: 90,
      distance: 420,
      is_open: true,
    };
    getEligibleRestaurantsMock.mockResolvedValue([candidate]);
    calculateSpinWeightsMock.mockReturnValue([5000]);
    weightedRandomIndexMock.mockReturnValue(0);
    // recordSpinEvent menyerap errornya sendiri dan menjawab null.
    recordSpinEventMock.mockResolvedValue(null);

    const response = await POST(
      spinRequest({
        ...VALID_BODY,
        session_id: "99999999-9999-4999-8999-999999999999",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ event_id: null });
  });

  it("menolak session_id yang bukan UUID", async () => {
    const response = await POST(
      spinRequest({ ...VALID_BODY, session_id: "bukan-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(recordSpinEventMock).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean only_open", async () => {
    const response = await POST(
      spinRequest({ ...VALID_BODY, only_open: "yes" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("returns 404 with no suggestions when nothing is mapped nearby", async () => {
    getEligibleRestaurantsMock.mockResolvedValue([]);

    const response = await POST(spinRequest(VALID_BODY));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NO_ELIGIBLE_RESTAURANTS",
      suggestions: { radius: null, budget: null, includeClosed: false },
    });
  });

  it("offers to include closed places when that is the only thing in the way", async () => {
    const candidate = {
      id: "33333333-3333-3333-3333-333333333333",
      name: "Warung Malam",
      category: "Nusantara",
      price_tier: 12000,
      hygiene_score: 70,
      distance: 300,
      is_open: false,
    };

    // Kandidatnya ada dan terjangkau; satu-satunya yang menyaringnya habis
    // adalah filter jam buka.
    getEligibleRestaurantsMock.mockImplementation(
      async (
        _budget: number,
        _radius: number,
        _lat: number,
        _lng: number,
        onlyOpen: boolean,
      ) => (onlyOpen ? [] : [candidate]),
    );

    const response = await POST(spinRequest(VALID_BODY));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      message: "Warungnya ada, tapi semuanya lagi tutup jam segini.",
      suggestions: { includeClosed: true },
    });
  });

  it("suggests a wider radius only when a wider radius actually helps", async () => {
    const candidate = {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Ayam Geprek",
      category: "Ayam",
      price_tier: 15000,
      hygiene_score: 90,
      distance: 2400,
    };

    // Kandidat hanya muncul kalau radiusnya dilebarkan; menaikkan budget tidak
    // menolong, jadi hanya saran radius yang boleh keluar.
    getEligibleRestaurantsMock.mockImplementation(
      async (_budget: number, radiusMeters: number) =>
        radiusMeters > 1000 ? [candidate] : [],
    );

    const response = await POST(spinRequest(VALID_BODY));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NO_ELIGIBLE_RESTAURANTS",
      suggestions: { radius: 3000, budget: null },
    });
  });

  it("suggests a higher budget when price is what rules everything out", async () => {
    const candidate = {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Nasi Padang",
      category: "Padang",
      price_tier: 30000,
      hygiene_score: 80,
      distance: 400,
    };

    getEligibleRestaurantsMock.mockImplementation(async (budget: number) =>
      budget > 20000 ? [candidate] : [],
    );

    const response = await POST(spinRequest(VALID_BODY));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      suggestions: { radius: null, budget: 40000 },
    });
  });

  it("still answers 404 when the diagnosis probes fail", async () => {
    getEligibleRestaurantsMock
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error("probe failed"));

    const response = await POST(spinRequest(VALID_BODY));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NO_ELIGIBLE_RESTAURANTS",
      suggestions: { radius: null, budget: null },
    });
  });

  it("rejects invalid JSON bodies", async () => {
    const response = await POST(spinRequest("{"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("throttles an IP that hammers the endpoint", async () => {
    getEligibleRestaurantsMock.mockResolvedValue([]);

    let lastStatus = 0;
    for (let attempt = 0; attempt < 31; attempt += 1) {
      const response = await POST(spinRequest(VALID_BODY));
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
    await expect(
      POST(spinRequest(VALID_BODY, "198.51.100.7")),
    ).resolves.toMatchObject({ status: 404 });
  });

  describe("bandit di belakang flag", () => {
    const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const candidates = [
      { id: "r1", name: "A", category: "Ayam", price_tier: 15000, hygiene_score: 90, distance: 200, is_open: true },
      { id: "r2", name: "B", category: "Mie", price_tier: 12000, hygiene_score: 90, distance: 400, is_open: true },
    ];

    it("mencatat thompson_v1 beserta propensity-nya saat bandit memilih", async () => {
      getEligibleRestaurantsMock.mockResolvedValue(candidates);
      prepareBanditMock.mockResolvedValue({ marker: "ctx" });
      chooseWithBanditMock.mockReturnValue({ index: 1, propensity: 0.37 });
      recordSpinEventMock.mockResolvedValue("e");

      const response = await POST(spinRequest({ ...VALID_BODY, session_id: SESSION }));
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.data.id).toBe("r2");
      expect(calculateSpinWeightsMock).not.toHaveBeenCalled();
      expect(recordSpinEventMock).toHaveBeenCalledWith(
        expect.objectContaining({ policy: "thompson_v1", policyScore: 0.37, restaurantId: "r2" }),
      );
    });

    it("kembali ke weighted_budget_v1 kalau bandit gagal memilih", async () => {
      getEligibleRestaurantsMock.mockResolvedValue(candidates);
      prepareBanditMock.mockResolvedValue({ marker: "ctx" });
      chooseWithBanditMock.mockReturnValue(null);
      calculateSpinWeightsMock.mockReturnValue([5000, 8000]);
      weightedRandomIndexMock.mockReturnValue(0);
      recordSpinEventMock.mockResolvedValue("e");

      const response = await POST(spinRequest({ ...VALID_BODY, session_id: SESSION }));

      expect(response.status).toBe(200);
      expect(recordSpinEventMock).toHaveBeenCalledWith(
        expect.objectContaining({ policy: "weighted_budget_v1", policyScore: 0.5 }),
      );
    });

    it("tidak memanggil bandit kalau pengguna di kelompok kontrol", async () => {
      getEligibleRestaurantsMock.mockResolvedValue(candidates);
      calculateSpinWeightsMock.mockReturnValue([5000, 8000]);
      weightedRandomIndexMock.mockReturnValue(0);

      await POST(spinRequest(VALID_BODY));
      expect(chooseWithBanditMock).not.toHaveBeenCalled();
    });
  });
});
