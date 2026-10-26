import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle bandit dibaca dengan fs saat runtime, jadi tidak terlacak otomatis.
  // Tanpa ini berkasnya tidak ikut ter-deploy dan /api/spin diam-diam selalu
  // kembali ke weighted_budget_v1.
  outputFileTracingIncludes: {
    "/api/spin": ["./ml/*.json"],
  },
};

export default nextConfig;
