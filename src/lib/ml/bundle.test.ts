import { describe, expect, it } from "vitest";

import {
  BUNDLE_FORMAT_VERSION,
  MIN_SERVING_EXAMPLES,
  parseBanditBundle,
  servingBlocker,
} from "@/lib/ml/bundle";
import { FEATURE_DIM } from "@/lib/ml/features";
import { ModelLoadError, trainModel } from "@/lib/ml/model";

function bundle(overrides: Record<string, unknown> = {}) {
  const model = trainModel([
    {
      eventId: "e",
      x: new Array<number>(FEATURE_DIM).fill(0.1),
      reward: 1,
      shownAt: "2026-09-01T00:00:00Z",
      restaurantId: "r",
      userId: "u",
      policyScore: 0.5,
      policy: "weighted_budget_v1",
    },
  ]);
  return {
    bundleVersion: BUNDLE_FORMAT_VERSION,
    model,
    snapshot: {
      globalImpressions: 10,
      globalAccepts: 4,
      restaurants: { r: { impressions: 3, accepts: 1 } },
    },
    synthetic: false,
    ...overrides,
  };
}

describe("parseBanditBundle", () => {
  it("menerima bundle yang sah", () => {
    expect(parseBanditBundle(bundle()).snapshot.globalAccepts).toBe(4);
  });

  it("menolak versi yang tidak dikenal", () => {
    expect(() => parseBanditBundle(bundle({ bundleVersion: 99 }))).toThrow(ModelLoadError);
  });

  it("menolak snapshot dengan accept lebih banyak dari tayang", () => {
    expect(() =>
      parseBanditBundle(
        bundle({
          snapshot: {
            globalImpressions: 1,
            globalAccepts: 1,
            restaurants: { r: { impressions: 1, accepts: 2 } },
          },
        }),
      ),
    ).toThrow(ModelLoadError);
  });

  it("tetap menolak artefak model yang susunannya salah", () => {
    const broken = bundle();
    broken.model = { ...broken.model, featureNames: [...broken.model.featureNames].reverse() };
    expect(() => parseBanditBundle(broken)).toThrow(/Susunan fitur/);
  });
});

describe("servingBlocker", () => {
  it("menolak model yang terlalu tipis", () => {
    expect(servingBlocker(parseBanditBundle(bundle()))).toMatch(
      new RegExp(`minimum ${MIN_SERVING_EXAMPLES}`),
    );
  });

  it("menolak bundle sintetis kecuali diizinkan", () => {
    const synthetic = parseBanditBundle(bundle({ synthetic: true }));
    expect(servingBlocker(synthetic)).toMatch(/sintetis/);
    expect(servingBlocker(synthetic, { allowSynthetic: true })).toBeNull();
  });
});
