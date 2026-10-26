/**
 * Membuat log spin SINTETIS untuk mencoba pipeline ML sebelum data nyata ada.
 *
 *   npx tsx scripts/synthesize-spins.ts            # 3000 spin
 *   npx tsx scripts/synthesize-spins.ts --n=8000
 *
 * Menulis ml/data/synthetic-spins.json dan ml/data/synthetic-restaurants.json,
 * dengan bentuk yang sama persis seperti ekspor dari Supabase Studio, supaya
 * train-bandit dan evaluate-bandit bisa dijalankan apa adanya.
 *
 * Kebijakan pengumpulnya meniru `weighted_budget_v1` — berbobot harga — tapi
 * diberi nama `synthetic_weighted_budget`. Nama itu yang membuat bundle hasil
 * pelatihannya otomatis ditandai sintetis dan DITOLAK saat menyajikan. Angka
 * dari sini membuktikan pipeline-nya jalan, bukan bahwa modelnya bekerja pada
 * manusia.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRng } from "@/lib/ml/linalg";
import { CUISINE_LABELS, toCuisineSlot } from "@/lib/ml/taxonomy";
import type { RawSpinRow } from "@/lib/ml/training";

import { arg } from "./lib/spin-export";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "ml/data");

const n = Number(arg("n") ?? 3000);
const rng = createRng(Number(arg("seed") ?? 20261026));

const labels = Object.values(CUISINE_LABELS);
const restaurants = Array.from({ length: 50 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  // Sepertiga tanpa kategori berarti, seperti data seed sebelum dikurasi.
  category: rng() < 0.33 ? "Restaurant" : labels[Math.floor(rng() * labels.length)],
  price_tier: 8000 + Math.round((rng() * rng() * 30000) / 1000) * 1000,
  // Seberapa disukai secara umum, tersembunyi dari model.
  quality: rng() * 2 - 1,
  baseKm: 0.1 + rng() * rng() * 3,
}));

const users = Array.from({ length: 60 }, (_, i) => ({
  id: `11111111-0000-4000-8000-${String(i).padStart(12, "0")}`,
  favourite: toCuisineSlot(labels[Math.floor(rng() * labels.length)]),
  budget: 15000 + Math.floor(rng() * 4) * 5000,
}));

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

const rows: RawSpinRow[] = [];
const start = Date.UTC(2026, 8, 1);

for (let i = 0; i < n; i += 1) {
  const user = users[Math.floor(rng() * users.length)];
  const shownAt = new Date(start + i * 7 * 60_000 + Math.floor(rng() * 60_000));
  const hour = (shownAt.getUTCHours() + 7) % 24;

  const candidates = restaurants
    .filter((r) => r.price_tier <= user.budget)
    .map((r) => ({ ...r, km: Math.max(0.05, r.baseKm + (rng() - 0.5) * 0.4) }))
    .filter((r) => r.km <= 2.5);
  if (candidates.length === 0) continue;

  // Sama dengan calculateSpinWeights: max(1, budget - harga).
  const weights = candidates.map((r) => Math.max(1, user.budget - r.price_tier));
  const total = weights.reduce((a, b) => a + b, 0);
  let draw = rng() * total;
  let index = candidates.length - 1;
  for (let j = 0; j < candidates.length; j += 1) {
    draw -= weights[j];
    if (draw <= 0) {
      index = j;
      break;
    }
  }
  const chosen = candidates[index];

  const likes = toCuisineSlot(chosen.category) === user.favourite ? 1.2 : 0;
  const p = sigmoid(-0.6 + chosen.quality + likes - 0.8 * chosen.km);

  rows.push({
    id: `22222222-0000-4000-8000-${String(i).padStart(12, "0")}`,
    user_id: user.id,
    restaurant_id: chosen.id,
    shown_at: shownAt.toISOString(),
    category: chosen.category,
    price_tier: chosen.price_tier,
    distance_km: Number(chosen.km.toFixed(3)),
    hour_local: hour,
    day_of_week: shownAt.getUTCDay(),
    is_raining: rng() < 0.3 ? null : rng() < 0.25,
    effective_action: rng() < p ? "accepted" : rng() < 0.6 ? "respun" : "ignored",
    policy_score: weights[index] / total,
    policy: "synthetic_weighted_budget",
    candidate_ids: candidates.map((r) => r.id),
    candidate_distances_m: candidates.map((r) => Math.round(r.km * 1000)),
  });
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "synthetic-spins.json"), JSON.stringify(rows));
writeFileSync(
  resolve(OUT_DIR, "synthetic-restaurants.json"),
  JSON.stringify(restaurants.map(({ id, category, price_tier }) => ({ id, category, price_tier }))),
);

const accepted = rows.filter((row) => row.effective_action === "accepted").length;
console.log(
  `${rows.length} spin sintetis, accept rate kebijakan pengumpul ${((100 * accepted) / rows.length).toFixed(1)}%.`,
);
console.log(`Ditulis ke ${OUT_DIR}`);
