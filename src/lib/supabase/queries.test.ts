import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
  },
}));

import {
  formatToPostGISPoint,
  getAllRestaurants,
  getEligibleRestaurants,
  HygieneReportError,
  parsePostGISPoint,
  submitHygieneReport,
} from "@/lib/supabase/queries";

describe("PostGIS helpers", () => {
  it("formats a WKT point using longitude-first order", () => {
    expect(formatToPostGISPoint(-6.92, 107.77)).toBe("POINT(107.77 -6.92)");
  });

  it("rejects coordinates outside valid ranges", () => {
    expect(() => formatToPostGISPoint(91, 107.77)).toThrow(RangeError);
    expect(() => formatToPostGISPoint(-6.92, 181)).toThrow(RangeError);
  });

  it("parses GeoJSON and WKT geography values", () => {
    expect(
      parsePostGISPoint({ type: "Point", coordinates: [107.77, -6.92] })
    ).toEqual({ lat: -6.92, lng: 107.77 });
    expect(parsePostGISPoint("POINT(107.77 -6.92)")).toEqual({
      lat: -6.92,
      lng: 107.77,
    });
  });

  it("parses EWKB hex geography values returned by Supabase", () => {
    expect(
      parsePostGISPoint("0101000020E61000002D78D15790F15A409566F3380CB61BC0")
    ).toEqual({ lat: -6.927781, lng: 107.774435 });
  });
});

describe("getEligibleRestaurants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the PostGIS RPC with the expected parameters and rounds distance", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          name: "Ayam Geprek",
          category: "Ayam",
          price_tier: 15000,
          hygiene_score: 90,
          distance: 123.6,
          is_open: true,
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          name: "Warteg Bahari",
          category: null,
          price_tier: 12000,
          hygiene_score: 80,
          distance: 987.2,
          is_open: null,
        },
      ],
      error: null,
    });

    const result = await getEligibleRestaurants(20000, 1000, -6.92, 107.77);

    expect(rpcMock).toHaveBeenCalledWith("get_eligible_restaurants", {
      budget: 20000,
      radius_meters: 1000,
      user_lat: -6.92,
      user_lng: 107.77,
      only_open: true,
    });
    expect(result).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Ayam Geprek",
        category: "Ayam",
        price_tier: 15000,
        hygiene_score: 90,
        distance: 124,
        is_open: true,
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        name: "Warteg Bahari",
        category: null,
        price_tier: 12000,
        hygiene_score: 80,
        distance: 987,
        is_open: null,
      },
    ]);
  });

  it("meneruskan only_open dan mempertahankan tiga keadaan jam buka", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          name: "Warung Malam",
          category: "Nusantara",
          price_tier: 12000,
          hygiene_score: 70,
          distance: 300,
          is_open: false,
        },
      ],
      error: null,
    });

    const result = await getEligibleRestaurants(20000, 1000, -6.92, 107.77, false);

    expect(rpcMock).toHaveBeenCalledWith(
      "get_eligible_restaurants",
      expect.objectContaining({ only_open: false }),
    );
    expect(result[0].is_open).toBe(false);
  });

  it("menganggap is_open yang hilang sebagai belum terdata, bukan tutup", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: "44444444-4444-4444-4444-444444444444",
          name: "Warung Tanpa Jadwal",
          category: null,
          price_tier: 10000,
          hygiene_score: 60,
          distance: 100,
        },
      ],
      error: null,
    });

    const [row] = await getEligibleRestaurants(20000, 1000, -6.92, 107.77);
    expect(row.is_open).toBeNull();
  });

  it("returns an empty array when the RPC returns no candidates", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await expect(
      getEligibleRestaurants(20000, 1000, -6.92, 107.77)
    ).resolves.toEqual([]);
  });

  it("throws a descriptive error when the RPC fails", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "boom", code: "PGRST500" },
    });

    await expect(
      getEligibleRestaurants(20000, 1000, -6.92, 107.77)
    ).rejects.toThrow(
      "getEligibleRestaurants: Supabase query failed — boom (code: PGRST500)"
    );
  });
});

describe("getAllRestaurants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses coordinates and derives hygiene status", async () => {
    const selectMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          name: "Ayam Geprek",
          category: "Ayam",
          price_tier: 15000,
          location: "POINT(107.77 -6.92)",
          hygiene_score: 90,
          is_verified_safe: true,
          created_at: "2026-05-10T00:00:00Z",
        },
      ],
      error: null,
    });

    fromMock.mockReturnValue({ select: selectMock });

    await expect(getAllRestaurants()).resolves.toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Ayam Geprek",
        category: "Ayam",
        price_tier: 15000,
        hygiene_score: 90,
        is_verified_safe: true,
        lat: -6.92,
        lng: 107.77,
        hygiene_status: "GREEN",
      },
    ]);
  });
});

describe("submitHygieneReport", () => {
  const RESTAURANT_ID = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates the whole write to the database function", async () => {
    const updatedRestaurant = {
      id: RESTAURANT_ID,
      name: "Ayam Geprek",
      category: "Ayam",
      price_tier: 15000,
      location: "POINT(107.77 -6.92)",
      hygiene_score: 40,
      is_verified_safe: false,
      created_at: "2026-05-10T00:00:00Z",
    };
    rpcMock.mockResolvedValue({ data: updatedRestaurant, error: null });

    await expect(
      submitHygieneReport(RESTAURANT_ID, "RED_FLAG", "Banyak lalat"),
    ).resolves.toMatchObject({ hygiene_score: 40, is_verified_safe: false });

    expect(rpcMock).toHaveBeenCalledWith("submit_hygiene_report", {
      p_restaurant_id: RESTAURANT_ID,
      p_report_type: "RED_FLAG",
      p_description: "Banyak lalat",
    });
    // Tidak ada penulisan langsung ke tabel: klien memang tidak punya haknya.
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("sends a null description when none is given", async () => {
    rpcMock.mockResolvedValue({ data: { id: RESTAURANT_ID }, error: null });

    await submitHygieneReport(RESTAURANT_ID, "CLEAN");

    expect(rpcMock).toHaveBeenCalledWith(
      "submit_hygiene_report",
      expect.objectContaining({ p_description: null }),
    );
  });

  it("unwraps a composite result returned as an array", async () => {
    rpcMock.mockResolvedValue({
      data: [{ id: RESTAURANT_ID, hygiene_score: 60 }],
      error: null,
    });

    await expect(
      submitHygieneReport(RESTAURANT_ID, "CLEAN"),
    ).resolves.toMatchObject({ hygiene_score: 60 });
  });

  it.each([
    ["RESTAURANT_NOT_FOUND", "RESTAURANT_NOT_FOUND"],
    ["COOLDOWN_ACTIVE", "COOLDOWN_ACTIVE"],
    ["INVALID_REPORT_TYPE", "INVALID_REPORT"],
    ["DESCRIPTION_TOO_LONG", "INVALID_REPORT"],
    ["connection reset by peer", "DATABASE_ERROR"],
  ])("maps database message %s to failure %s", async (message, failure) => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message, code: "PT400" },
    });

    await expect(
      submitHygieneReport(RESTAURANT_ID, "RED_FLAG"),
    ).rejects.toMatchObject({ failure });
  });

  it("fails loudly when the function returns nothing", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await expect(
      submitHygieneReport(RESTAURANT_ID, "CLEAN"),
    ).rejects.toBeInstanceOf(HygieneReportError);
  });
});
