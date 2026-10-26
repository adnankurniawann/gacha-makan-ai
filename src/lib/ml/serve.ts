/**
 * Penyajian bandit di /api/spin — di belakang flag, mati secara default.
 *
 *   BANDIT_ROLLOUT=0.2          porsi pengguna yang dilayani bandit (0..1)
 *   BANDIT_BUNDLE_PATH=...      default ml/bandit.json
 *   BANDIT_ALLOW_SYNTHETIC=true hanya untuk mencoba alurnya secara lokal
 *
 * Aturan yang dipegang sama dengan konteks cuaca: spin tidak pernah gagal
 * karena fitur ini. Bundle yang hilang, rusak, terlalu tipis, atau query
 * riwayat yang gagal — semuanya jatuh kembali ke `weighted_budget_v1` dengan
 * satu peringatan di log, bukan error ke pengguna.
 *
 * Pembagian kelompok per pengguna, bukan per permintaan, supaya pengalaman
 * satu orang konsisten dan perbandingan A/B tidak mengukur campuran.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseBanditBundle, servingBlocker, type BanditBundle } from "@/lib/ml/bundle";
import { decideThompson, inRollout, type PolicyDecision } from "@/lib/ml/policy";
import { PriorTracker, type ImpressionContext } from "@/lib/ml/training";
import { localTimeContext } from "@/lib/supabase/events";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Berapa penayangan terakhir pengguna yang dibaca untuk fitur afinitas.
 * Cukup untuk pengguna paling aktif sekalipun, dan membatasi ukuran query.
 */
const HISTORY_LIMIT = 500;

export function banditRolloutFraction(): number {
  const value = Number(process.env.BANDIT_ROLLOUT ?? 0);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

type BundleState = { bundle: BanditBundle } | { error: string };
let cached: BundleState | null = null;

/**
 * Dibaca sekali per instance. Kegagalan juga di-cache: mencoba membaca berkas
 * yang sama di setiap spin hanya mengulang peringatan yang sama.
 */
function loadBundle(): BundleState {
  if (cached) return cached;
  // turbopackIgnore: path dari env tidak bisa dilacak secara statis, dan tanpa
  // komentar ini Turbopack menelusuri seluruh proyek. Berkasnya sendiri sudah
  // dimasukkan lewat outputFileTracingIncludes di next.config.ts.
  const path = resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.BANDIT_BUNDLE_PATH ?? "ml/bandit.json",
  );
  try {
    const bundle = parseBanditBundle(JSON.parse(readFileSync(path, "utf8")));
    const blocker = servingBlocker(bundle, {
      allowSynthetic: process.env.BANDIT_ALLOW_SYNTHETIC === "true",
    });
    cached = blocker ? { error: blocker } : { bundle };
  } catch (error) {
    cached = { error: error instanceof Error ? error.message : String(error) };
  }
  if ("error" in cached) {
    console.warn(`[bandit] Tidak menyajikan, kembali ke weighted_budget_v1: ${cached.error}`);
  }
  return cached;
}

/** Hanya untuk test. */
export function __resetBanditCache(): void {
  cached = null;
}

export interface BanditContext {
  bundle: BanditBundle;
  userId: string;
  tracker: PriorTracker;
}

interface HistoryRow {
  restaurant_id: string;
  category: string | null;
  price_tier: number | null;
  distance_km: number;
  hour_local: number;
  day_of_week: number;
  is_raining: boolean | null;
  effective_action: string;
}

/**
 * Menyiapkan bandit untuk permintaan ini, atau `null` kalau permintaan ini
 * dilayani kebijakan lama.
 *
 * Dipanggil bersamaan dengan query kandidat, jadi untuk kelompok perlakuan
 * tambahan latensinya kira-kira satu round trip — bukan dua. Untuk semua
 * orang lain, termasuk saat flag mati, fungsi ini selesai tanpa menyentuh
 * jaringan sama sekali.
 *
 * Tidak pernah melempar.
 */
export async function prepareBandit(): Promise<BanditContext | null> {
  const fraction = banditRolloutFraction();
  if (fraction === 0) return null;

  const state = loadBundle();
  if ("error" in state) return null;

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !inRollout(user.id, fraction)) return null;

    // RLS membatasi view ini ke baris milik pengguna yang meminta.
    const { data, error } = await supabase
      .from("spin_history_for_bandit")
      .select(
        "restaurant_id, category, price_tier, distance_km, hour_local, day_of_week, is_raining, effective_action",
      )
      .order("shown_at", { ascending: false })
      .limit(HISTORY_LIMIT);

    if (error) {
      console.warn("[bandit] Gagal membaca riwayat:", error.message);
      return null;
    }

    // Snapshot sudah memuat penayangan ini di angka global dan restoran;
    // yang ditambahkan di sini hanya afinitas pengguna.
    const tracker = new PriorTracker(state.bundle.snapshot);
    for (const row of ((data ?? []) as HistoryRow[]).reverse()) {
      tracker.observe(
        {
          userId: user.id,
          restaurantId: row.restaurant_id,
          category: row.category,
          priceTier: row.price_tier,
          distanceKm: Number(row.distance_km),
          hourLocal: row.hour_local,
          dayOfWeek: row.day_of_week,
          isRaining: row.is_raining,
        },
        row.effective_action === "accepted",
        false,
      );
    }

    return { bundle: state.bundle, userId: user.id, tracker };
  } catch (error) {
    console.warn("[bandit] Gagal menyiapkan:", error instanceof Error ? error.message : error);
    return null;
  }
}

export interface BanditCandidate {
  id: string;
  category: string | null;
  price_tier: number;
  /** Meter. */
  distance: number;
}

/**
 * Memilih satu kandidat. `null` kalau ada yang salah — pemanggil kembali ke
 * kebijakan lama.
 */
export function chooseWithBandit(
  context: BanditContext,
  candidates: BanditCandidate[],
  isRaining: boolean | null,
  now: Date = new Date(),
  rng: () => number = Math.random,
): PolicyDecision | null {
  try {
    // Dihitung dengan fungsi yang sama dengan yang membekukan konteks di
    // spin_events, supaya fitur penyajian sama dengan fitur pelatihan nanti.
    const { hourLocal, dayOfWeek } = localTimeContext(now);
    const xs = candidates.map((candidate) => {
      const ctx: ImpressionContext = {
        userId: context.userId,
        restaurantId: candidate.id,
        category: candidate.category,
        priceTier: candidate.price_tier,
        distanceKm: candidate.distance / 1000,
        hourLocal,
        dayOfWeek,
        isRaining,
      };
      return context.tracker.features(ctx);
    });
    return decideThompson(context.bundle.model, xs, rng);
  } catch (error) {
    console.warn("[bandit] Gagal memilih:", error instanceof Error ? error.message : error);
    return null;
  }
}
