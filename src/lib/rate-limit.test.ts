import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRateLimits,
  clientIp,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    __resetRateLimits();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit and blocks the next one", () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(rateLimit("k", 3, 1000).allowed).toBe(true);
    }

    const blocked = rateLimit("k", 3, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each key separately", () => {
    rateLimit("a", 1, 1000);
    expect(rateLimit("a", 1, 1000).allowed).toBe(false);
    expect(rateLimit("b", 1, 1000).allowed).toBe(true);
  });

  it("frees up capacity as the window slides, not all at once", () => {
    vi.setSystemTime(0);
    rateLimit("k", 2, 1000);

    vi.setSystemTime(600);
    rateLimit("k", 2, 1000);
    expect(rateLimit("k", 2, 1000).allowed).toBe(false);

    // Setelah hit pertama keluar window, satu jatah kembali — tapi hanya satu.
    vi.setSystemTime(1100);
    expect(rateLimit("k", 2, 1000).allowed).toBe(true);
    expect(rateLimit("k", 2, 1000).allowed).toBe(false);
  });

  it("does not keep idle keys forever", () => {
    vi.setSystemTime(0);
    rateLimit("stale", 1, 1000);

    // Lewat jauh dari ambang eviction, lalu satu panggilan untuk memicu sweep.
    vi.setSystemTime(60 * 60 * 1000);
    rateLimit("fresh", 1, 1000);

    // Kunci lama sudah dibuang, jadi jatahnya utuh lagi.
    expect(rateLimit("stale", 1, 1000).allowed).toBe(true);
  });
});

describe("clientIp", () => {
  const requestWith = (headers: Record<string, string>) =>
    new Request("http://localhost/api/spin", { method: "POST", headers });

  it("takes the first entry of x-forwarded-for", () => {
    expect(
      clientIp(requestWith({ "x-forwarded-for": "203.0.113.1, 10.0.0.1" })),
    ).toBe("203.0.113.1");
  });

  it("falls back to x-real-ip, then to a placeholder", () => {
    expect(clientIp(requestWith({ "x-real-ip": "198.51.100.4" }))).toBe(
      "198.51.100.4",
    );
    expect(clientIp(requestWith({}))).toBe("unknown");
  });
});

describe("rateLimitHeaders", () => {
  it("adds Retry-After only when the caller is blocked", () => {
    expect(
      rateLimitHeaders(
        { allowed: true, remaining: 4, retryAfterSeconds: 0 },
        10,
      ),
    ).toEqual({ "X-RateLimit-Limit": "10", "X-RateLimit-Remaining": "4" });

    expect(
      rateLimitHeaders(
        { allowed: false, remaining: 0, retryAfterSeconds: 12 },
        10,
      ),
    ).toMatchObject({ "Retry-After": "12" });
  });
});
