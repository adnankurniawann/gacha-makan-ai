import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAllRestaurantsMock } = vi.hoisted(() => ({
  getAllRestaurantsMock: vi.fn(),
}));

vi.mock("@/lib/supabase/queries", () => ({
  getAllRestaurants: getAllRestaurantsMock,
  supabase: {},
}));

import { GET } from "@/app/api/restaurants/route";

describe("GET /api/restaurants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns restaurant data", async () => {
    getAllRestaurantsMock.mockResolvedValue([
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

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
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
      ],
    });
  });

  it("returns a database error when the query fails", async () => {
    getAllRestaurantsMock.mockRejectedValue(new Error("database down"));

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "DATABASE_ERROR",
      error: "database down",
    });
  });
});