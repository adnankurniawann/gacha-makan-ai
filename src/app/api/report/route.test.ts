import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitHygieneReportMock, HygieneReportErrorMock } = vi.hoisted(() => {
  // Kelas asli tidak bisa diimpor di sini: modul queries menarik client.ts
  // yang melempar error kalau env Supabase tidak ada. Yang penting route dan
  // test memakai objek kelas yang sama, supaya `instanceof` tetap benar.
  class HygieneReportError extends Error {
    constructor(
      readonly failure: string,
      message: string,
    ) {
      super(message);
      this.name = "HygieneReportError";
    }
  }

  return {
    submitHygieneReportMock: vi.fn(),
    HygieneReportErrorMock: HygieneReportError,
  };
});

vi.mock("@/lib/supabase/queries", () => ({
  supabase: { from: vi.fn() },
  submitHygieneReport: submitHygieneReportMock,
  HygieneReportError: HygieneReportErrorMock,
}));

import { POST } from "@/app/api/report/route";
import { __resetRateLimits } from "@/lib/rate-limit";

const RESTAURANT_ID = "11111111-1111-1111-1111-111111111111";

const restaurantRecord = {
  id: RESTAURANT_ID,
  hygiene_score: 40,
  is_verified_safe: false,
  name: "Ayam Geprek",
  category: "Ayam",
  price_tier: 15000,
  location: "POINT(107.77 -6.92)",
  created_at: "2026-05-10T00:00:00Z",
};

function reportRequest(
  body: unknown,
  ip = "203.0.113.10",
): Request {
  return new Request("http://localhost/api/report", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("POST /api/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimits();
  });

  it("rejects invalid report types", async () => {
    const response = await POST(
      reportRequest({ restaurant_id: RESTAURANT_ID, report_type: "DIRTY" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_REPORT_TYPE",
    });
    expect(submitHygieneReportMock).not.toHaveBeenCalled();
  });

  it("rejects a restaurant_id that is not a UUID", async () => {
    const response = await POST(
      reportRequest({ restaurant_id: "not-a-uuid", report_type: "CLEAN" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(submitHygieneReportMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the restaurant is missing", async () => {
    submitHygieneReportMock.mockRejectedValue(
      new HygieneReportErrorMock("RESTAURANT_NOT_FOUND", "RESTAURANT_NOT_FOUND"),
    );

    const response = await POST(
      reportRequest({ restaurant_id: RESTAURANT_ID, report_type: "RED_FLAG" }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "RESTAURANT_NOT_FOUND",
    });
  });

  it("returns 429 when the per-restaurant cooldown is still active", async () => {
    submitHygieneReportMock.mockRejectedValue(
      new HygieneReportErrorMock("COOLDOWN_ACTIVE", "COOLDOWN_ACTIVE"),
    );

    const response = await POST(
      reportRequest({ restaurant_id: RESTAURANT_ID, report_type: "RED_FLAG" }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: "COOLDOWN_ACTIVE",
    });
  });

  it("returns 500 when the database call fails", async () => {
    submitHygieneReportMock.mockRejectedValue(
      new HygieneReportErrorMock("DATABASE_ERROR", "connection reset"),
    );

    const response = await POST(
      reportRequest({ restaurant_id: RESTAURANT_ID, report_type: "CLEAN" }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "DATABASE_ERROR",
    });
  });

  it("saves the report and returns updated restaurant data", async () => {
    submitHygieneReportMock.mockResolvedValue(restaurantRecord);

    const response = await POST(
      reportRequest({
        restaurant_id: RESTAURANT_ID,
        report_type: "RED_FLAG",
        description: "Banyak lalat",
      }),
    );

    expect(response.status).toBe(200);
    expect(submitHygieneReportMock).toHaveBeenCalledWith(
      RESTAURANT_ID,
      "RED_FLAG",
      "Banyak lalat",
    );
    await expect(response.json()).resolves.toEqual({ data: restaurantRecord });
  });

  it("throttles an IP that floods the endpoint", async () => {
    submitHygieneReportMock.mockResolvedValue(restaurantRecord);

    let lastStatus = 0;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await POST(
        reportRequest({ restaurant_id: RESTAURANT_ID, report_type: "CLEAN" }),
      );
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);

    // IP lain tidak ikut kena imbas.
    const other = await POST(
      reportRequest(
        { restaurant_id: RESTAURANT_ID, report_type: "CLEAN" },
        "198.51.100.7",
      ),
    );
    expect(other.status).toBe(200);
  });
});
