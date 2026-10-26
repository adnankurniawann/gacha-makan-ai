import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: createClientMock,
}));

import { BUNDLE_FORMAT_VERSION } from "@/lib/ml/bundle";
import { FEATURE_DIM } from "@/lib/ml/features";
import { createRng } from "@/lib/ml/linalg";
import { trainModel } from "@/lib/ml/model";
import { __resetBanditCache, chooseWithBandit, prepareBandit } from "@/lib/ml/serve";

const USER = "user-1";

function writeBundle(overrides: Record<string, unknown> = {}): string {
  const model = trainModel(
    Array.from({ length: 600 }, (_, i) => ({
      eventId: `e${i}`,
      x: new Array<number>(FEATURE_DIM).fill(i % 2 ? 0.2 : -0.2),
      reward: i % 2,
      shownAt: "2026-09-01T00:00:00Z",
      restaurantId: "r",
      userId: "u",
      policyScore: 0.5,
      policy: "weighted_budget_v1",
    })),
  );
  const dir = mkdtempSync(join(tmpdir(), "bandit-"));
  const path = join(dir, "bandit.json");
  writeFileSync(
    path,
    JSON.stringify({
      bundleVersion: BUNDLE_FORMAT_VERSION,
      model,
      snapshot: {
        globalImpressions: 100,
        globalAccepts: 30,
        restaurants: { r1: { impressions: 40, accepts: 20 } },
      },
      synthetic: false,
      ...overrides,
    }),
  );
  return path;
}

function fakeSupabase(history: unknown[], userId: string | null = USER) {
  const query = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: history, error: null }),
  };
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }) },
    from: vi.fn().mockReturnValue(query),
  };
}

describe("prepareBandit", () => {
  const env = { ...process.env };

  beforeEach(() => {
    __resetBanditCache();
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("flag mati: tidak menyentuh jaringan sama sekali", async () => {
    delete process.env.BANDIT_ROLLOUT;
    expect(await prepareBandit()).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("bundle hilang: kembali ke kebijakan lama, tanpa melempar", async () => {
    process.env.BANDIT_ROLLOUT = "1";
    process.env.BANDIT_BUNDLE_PATH = "/tidak/ada/bandit.json";
    expect(await prepareBandit()).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("bundle sintetis ditolak kecuali diizinkan", async () => {
    process.env.BANDIT_ROLLOUT = "1";
    process.env.BANDIT_BUNDLE_PATH = writeBundle({ synthetic: true });
    createClientMock.mockResolvedValue(fakeSupabase([]));
    expect(await prepareBandit()).toBeNull();

    __resetBanditCache();
    process.env.BANDIT_ALLOW_SYNTHETIC = "true";
    expect(await prepareBandit()).not.toBeNull();
  });

  it("tanpa sesi: kebijakan lama", async () => {
    process.env.BANDIT_ROLLOUT = "1";
    process.env.BANDIT_BUNDLE_PATH = writeBundle();
    createClientMock.mockResolvedValue(fakeSupabase([], null));
    expect(await prepareBandit()).toBeNull();
  });

  it("riwayat pengguna mengisi afinitas tanpa menggandakan angka snapshot", async () => {
    process.env.BANDIT_ROLLOUT = "1";
    process.env.BANDIT_BUNDLE_PATH = writeBundle();
    createClientMock.mockResolvedValue(
      fakeSupabase([
        {
          restaurant_id: "r1",
          category: "Ayam",
          price_tier: 15000,
          distance_km: "0.300",
          hour_local: 12,
          day_of_week: 2,
          is_raining: null,
          effective_action: "accepted",
        },
      ]),
    );

    const ctx = await prepareBandit();
    expect(ctx).not.toBeNull();

    const input = ctx!.tracker.featureInput({
      userId: USER,
      restaurantId: "r1",
      category: "Ayam",
      priceTier: 15000,
      distanceKm: 0.3,
      hourLocal: 12,
      dayOfWeek: 2,
      isRaining: null,
    });
    // Popularitas tetap dari snapshot, tidak ditambah riwayat pengguna.
    expect(input.restaurantStats).toEqual({ impressions: 40, accepts: 20 });
    expect(input.globalAcceptRate).toBeCloseTo(0.3);
    // Afinitas pengguna dari riwayatnya sendiri.
    expect(input.userCategoryStats).toEqual({ impressions: 1, accepts: 1 });
    expect(input.userMeanAcceptedPrice).toBe(15000);
  });
});

describe("chooseWithBandit", () => {
  beforeEach(() => {
    __resetBanditCache();
  });

  it("memilih indeks yang sah dengan propensity dalam (0, 1]", async () => {
    process.env.BANDIT_ROLLOUT = "1";
    process.env.BANDIT_BUNDLE_PATH = writeBundle();
    createClientMock.mockResolvedValue(fakeSupabase([]));
    const ctx = await prepareBandit();

    const decision = chooseWithBandit(
      ctx!,
      [
        { id: "r1", category: "Ayam", price_tier: 15000, distance: 300 },
        { id: "r2", category: "Mie", price_tier: 12000, distance: 900 },
      ],
      null,
      new Date("2026-10-26T05:00:00Z"),
      createRng(1),
    );

    expect(decision).not.toBeNull();
    expect([0, 1]).toContain(decision!.index);
    expect(decision!.propensity).toBeGreaterThan(0);
    expect(decision!.propensity).toBeLessThanOrEqual(1);
  });
});
