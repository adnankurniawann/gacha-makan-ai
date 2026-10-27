import { describe, expect, it } from "vitest";

import { formatHygieneScore, UNRATED_HYGIENE_LABEL } from "@/utils/hygiene";

describe("formatHygieneScore", () => {
  it("shows the score when there is one, including zero", () => {
    expect(formatHygieneScore(85)).toBe("85");
    expect(formatHygieneScore(0)).toBe("0");
  });

  it("says unrated instead of inventing a score", () => {
    expect(formatHygieneScore(null)).toBe(UNRATED_HYGIENE_LABEL);
    expect(formatHygieneScore(undefined)).toBe(UNRATED_HYGIENE_LABEL);
  });
});
