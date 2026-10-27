import { describe, expect, it } from "vitest";

import { formatPrice, isKnownPrice, UNKNOWN_PRICE_LABEL } from "@/utils/price";

describe("formatPrice", () => {
  it("formats a known price in rupiah", () => {
    expect(formatPrice(15000)).toBe("Rp 15.000");
  });

  it("says the price is unknown instead of guessing", () => {
    expect(formatPrice(null)).toBe(UNKNOWN_PRICE_LABEL);
    expect(formatPrice(undefined)).toBe(UNKNOWN_PRICE_LABEL);
    expect(formatPrice(0)).toBe(UNKNOWN_PRICE_LABEL);
  });
});

describe("isKnownPrice", () => {
  it("accepts only positive finite numbers", () => {
    expect(isKnownPrice(12000)).toBe(true);
    expect(isKnownPrice(null)).toBe(false);
    expect(isKnownPrice(0)).toBe(false);
    expect(isKnownPrice(Number.NaN)).toBe(false);
  });
});
