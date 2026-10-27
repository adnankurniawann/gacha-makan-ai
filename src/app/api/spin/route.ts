/**
 * POST /api/spin
 *
 * Spin the gacha: filter eligible restaurants by hygiene, budget, and radius,
 * then perform weighted random selection and return the chosen restaurant.
 *
 * Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5,
 *               10.1, 10.2, 10.3, 10.6, 10.7
 */

import { getEligibleRestaurants } from "@/lib/supabase/queries";
import {
  calculateSpinWeights,
  selectionPropensity,
  weightedRandomIndex,
  SPIN_POLICY,
} from "@/utils/gacha";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { recordSpinEvent, recordSpinMiss } from "@/lib/supabase/events";
import { currentIsRaining, needsRefresh, refreshWeather } from "@/lib/weather";
import { chooseWithBandit, prepareBandit } from "@/lib/ml/serve";
import { BANDIT_POLICY } from "@/lib/ml/policy";

/** UUID apa pun versinya — session_id dibuat oleh crypto.randomUUID di klien. */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Setiap spin memicu query PostGIS. Tanpa batas ini satu skrip bisa
 * menghabiskan kuota Supabase dalam semalam. 30 spin per menit jauh di atas
 * pemakaian manusia yang paling gelisah sekalipun.
 */
const RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Batas atas parameter, dipakai juga saat menghitung saran radius/budget. */
const MAX_BUDGET = 100_000_000;
const MAX_RADIUS = 50_000;

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `value` is a finite integer within [min, max] (inclusive).
 */
function isValidInteger(value: unknown, min: number, max: number): boolean {
  if (typeof value !== "number") return false;
  if (!Number.isFinite(value)) return false;
  if (!Number.isInteger(value)) return false;
  return value >= min && value <= max;
}

/**
 * Returns true if `value` is a finite float within [min, max] (inclusive).
 */
function isValidFloat(value: unknown, min: number, max: number): boolean {
  if (typeof value !== "number") return false;
  if (!Number.isFinite(value)) return false;
  return value >= min && value <= max;
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

interface EmptyResultDiagnosis {
  widerRadius: number | null;
  higherBudget: number | null;
  /** True kalau kandidatnya ada, tapi semuanya sedang tutup. */
  closedForNow: boolean;
}

/**
 * Cari tahu apa yang sebenarnya membuat kandidat kosong: jaraknya, harganya,
 * atau jam bukanya. Probe ini hanya jalan di jalur gagal, dan hasilnya dipakai
 * untuk memberi saran yang benar — bukan menebak "coba perbesar radius" pada
 * kasus yang radiusnya sudah cukup luas sejak awal.
 */
async function diagnoseEmptyResult(
  budget: number,
  radius: number,
  lat: number,
  lng: number,
  onlyOpen: boolean,
): Promise<EmptyResultDiagnosis> {
  const widerRadius = Math.min(MAX_RADIUS, radius * 3);
  const higherBudget = Math.min(MAX_BUDGET, Math.max(budget * 2, budget + 15_000));

  const [byRadius, byBudget, byHours] = await Promise.allSettled([
    widerRadius > radius
      ? getEligibleRestaurants(budget, widerRadius, lat, lng, onlyOpen)
      : Promise.resolve([]),
    higherBudget > budget
      ? getEligibleRestaurants(higherBudget, radius, lat, lng, onlyOpen)
      : Promise.resolve([]),
    onlyOpen
      ? getEligibleRestaurants(budget, radius, lat, lng, false)
      : Promise.resolve([]),
  ]);

  const helped = (outcome: PromiseSettledResult<unknown[]>) =>
    outcome.status === "fulfilled" && outcome.value.length > 0;

  return {
    widerRadius: helped(byRadius) ? widerRadius : null,
    higherBudget: helped(byBudget) ? higherBudget : null,
    closedForNow: helped(byHours),
  };
}

export async function POST(request: Request): Promise<Response> {
  // Dimulai sebelum apa pun, supaya angka p95 mencerminkan yang benar-benar
  // dirasakan pemanggil — termasuk waktu parsing dan validasi.
  const startedAt = Date.now();

  try {
    // ------------------------------------------------------------------
    // 0. Rate limit sebelum menyentuh database
    // ------------------------------------------------------------------
    const limit = rateLimit(
      `spin:${clientIp(request)}`,
      RATE_LIMIT,
      RATE_LIMIT_WINDOW_MS,
    );

    if (!limit.allowed) {
      return Response.json(
        {
          error: "Too many spins. Slow down.",
          code: "RATE_LIMITED",
          message: `Santai dulu, coba lagi ${limit.retryAfterSeconds} detik lagi.`,
        },
        { status: 429, headers: rateLimitHeaders(limit, RATE_LIMIT) },
      );
    }

    // ------------------------------------------------------------------
    // 1. Parse JSON body
    // ------------------------------------------------------------------
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON.", code: "INVALID_INPUT" },
        { status: 400 }
      );
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { error: "Request body must be a JSON object.", code: "INVALID_INPUT" },
        { status: 400 }
      );
    }

    const params = body as Record<string, unknown>;

    // ------------------------------------------------------------------
    // 2. Check required fields are present
    // ------------------------------------------------------------------
    const requiredFields = ["budget", "radius", "user_lat", "user_lng"] as const;
    for (const field of requiredFields) {
      if (!(field in params) || params[field] === undefined || params[field] === null) {
        return Response.json(
          {
            error: `Missing required parameter: "${field}".`,
            code: "INVALID_INPUT",
          },
          { status: 400 }
        );
      }
    }

    const { budget, radius, user_lat, user_lng } = params;

    // ------------------------------------------------------------------
    // 3. Validate ranges
    //    budget:   integer, 1 – 100_000_000
    //    radius:   integer, 1 – 50_000
    //    user_lat: float,   -90 – 90
    //    user_lng: float,   -180 – 180
    // ------------------------------------------------------------------
    if (!isValidInteger(budget, 1, MAX_BUDGET)) {
      return Response.json(
        {
          error:
            'Parameter "budget" must be an integer between 1 and 100,000,000.',
          code: "INVALID_INPUT",
        },
        { status: 400 }
      );
    }

    if (!isValidInteger(radius, 1, MAX_RADIUS)) {
      return Response.json(
        {
          error:
            'Parameter "radius" must be an integer between 1 and 50,000.',
          code: "INVALID_INPUT",
        },
        { status: 400 }
      );
    }

    if (!isValidFloat(user_lat, -90, 90)) {
      return Response.json(
        {
          error: 'Parameter "user_lat" must be a float between -90 and 90.',
          code: "INVALID_INPUT",
        },
        { status: 400 }
      );
    }

    if (!isValidFloat(user_lng, -180, 180)) {
      return Response.json(
        {
          error: 'Parameter "user_lng" must be a float between -180 and 180.',
          code: "INVALID_INPUT",
        },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------------
    // 3a. only_open — opsional. Default true: merekomendasikan tempat yang
    //     sudah tutup adalah cara tercepat kehilangan kepercayaan orang.
    // ------------------------------------------------------------------
    const { only_open, session_id } = params;

    if (only_open !== undefined && typeof only_open !== "boolean") {
      return Response.json(
        {
          error: 'Parameter "only_open" must be a boolean.',
          code: "INVALID_INPUT",
        },
        { status: 400 }
      );
    }

    // session_id mengelompokkan spin dalam satu duduk. Opsional: spin tetap
    // boleh jalan tanpa itu, cuma tidak ikut tercatat.
    if (
      session_id !== undefined &&
      (typeof session_id !== "string" || !UUID_REGEX.test(session_id))
    ) {
      return Response.json(
        {
          error: 'Parameter "session_id" must be a UUID.',
          code: "INVALID_INPUT",
        },
        { status: 400 }
      );
    }

    // All params are now validated — cast to their concrete types.
    const budgetNum = budget as number;
    const radiusNum = radius as number;
    const userLat = user_lat as number;
    const userLng = user_lng as number;
    const onlyOpen = only_open ?? true;

    // ------------------------------------------------------------------
    // 4. Fetch eligible restaurants (hygiene >= 50, price_tier <= budget
    //    atau belum diketahui, distance <= radius)
    // ------------------------------------------------------------------
    // Disiapkan bersamaan dengan query kandidat. Selesai seketika tanpa
    // jaringan kalau BANDIT_ROLLOUT=0, dan tidak pernah melempar.
    const banditPromise = prepareBandit();

    let candidates;
    try {
      candidates = await getEligibleRestaurants(
        budgetNum,
        radiusNum,
        userLat,
        userLng,
        onlyOpen
      );
    } catch (dbError) {
      // Errors thrown by getEligibleRestaurants are DB errors.
      const message =
        dbError instanceof Error ? dbError.message : String(dbError);
      console.error("[POST /api/spin] Database error:", message);
      return Response.json(
        {
          error: `Database error while fetching restaurants: ${message}`,
          code: "DATABASE_ERROR",
        },
        { status: 500 }
      );
    }

    // ------------------------------------------------------------------
    // 5. Tidak ada kandidat — jelaskan penyebabnya dan beri jalan keluar
    //    yang sudah dipastikan berhasil, bukan saran asal.
    // ------------------------------------------------------------------
    if (candidates.length === 0) {
      let diagnosis: EmptyResultDiagnosis = {
        widerRadius: null,
        higherBudget: null,
        closedForNow: false,
      };
      try {
        diagnosis = await diagnoseEmptyResult(
          budgetNum,
          radiusNum,
          userLat,
          userLng,
          onlyOpen,
        );
      } catch (diagnosisError) {
        // Diagnosa hanya nilai tambah; kegagalannya tidak boleh mengubah
        // jawaban utama menjadi 500.
        console.warn(
          "[POST /api/spin] Diagnosa kandidat kosong gagal:",
          diagnosisError instanceof Error
            ? diagnosisError.message
            : String(diagnosisError),
        );
      }

      // Urutan saran mengikuti seberapa kecil pengorbanannya bagi pengguna:
      // menunggu jam buka yang salah lebih murah daripada jalan lebih jauh,
      // dan jalan lebih jauh lebih murah daripada membayar lebih mahal.
      // Kandidat kosong tidak meninggalkan jejak di spin_events, padahal ini
      // kegagalan yang paling penting diketahui: ia menandai lubang cakupan
      // data, dan orang yang mengalaminya kemungkinan besar tidak kembali.
      if (session_id) {
        await recordSpinMiss({
          sessionId: session_id,
          userLat,
          userLng,
          radiusMeters: radiusNum,
          budget: budgetNum,
          onlyOpen,
          wideningHelps: diagnosis.widerRadius !== null,
          budgetHelps: diagnosis.higherBudget !== null,
          closedOnly: diagnosis.closedForNow,
        });
      }

      const message = diagnosis.closedForNow
        ? "Warungnya ada, tapi semuanya lagi tutup jam segini."
        : diagnosis.widerRadius
          ? `Belum ada warung dalam ${radiusNum} m. Ada yang cocok kalau radiusnya dilebarkan.`
          : diagnosis.higherBudget
            ? `Belum ada warung dengan budget Rp${budgetNum.toLocaleString("id-ID")}. Ada yang cocok kalau budgetnya dinaikkan.`
            : "Belum ada warung yang terdata di sekitar sini. Coba geser lokasi atau bantu tambahkan warungnya.";

      return Response.json(
        {
          error:
            "No eligible restaurants found for the given budget and radius.",
          code: "NO_ELIGIBLE_RESTAURANTS",
          message,
          suggestions: {
            radius: diagnosis.widerRadius,
            budget: diagnosis.higherBudget,
            includeClosed: diagnosis.closedForNow,
          },
        },
        { status: 404, headers: rateLimitHeaders(limit, RATE_LIMIT) }
      );
    }

    // ------------------------------------------------------------------
    // 6–7. Pilih satu kandidat.
    //
    //    Bandit kalau pengguna ini masuk kelompok perlakuan dan bundlenya
    //    layak; selain itu, atau kalau bandit gagal karena alasan apa pun,
    //    acak berbobot max(1, budget - price_tier), bobot 1 untuk harga yang
    //    belum diketahui (calculateSpinWeights). Keduanya
    //    mencatat peluang pilihannya sendiri sebagai policy_score.
    // ------------------------------------------------------------------
    // Dibaca dari cache saja. Kalau dingin, tercatat null — spin tidak
    // pernah menunggu jaringan demi satu kolom fitur.
    const isRaining = currentIsRaining(userLat, userLng);

    const bandit = await banditPromise;
    const decision = bandit ? chooseWithBandit(bandit, candidates, isRaining) : null;

    let selectedIndex: number;
    let policyScore: number;
    let policy: string;

    if (decision) {
      selectedIndex = decision.index;
      policyScore = decision.propensity;
      policy = BANDIT_POLICY;
    } else {
      const weights = calculateSpinWeights(candidates, budgetNum);
      // Indeksnya, bukan langsung itemnya: peluang draw ini hanya bisa
      // dihitung kalau kita tahu kandidat mana yang keluar.
      selectedIndex = weightedRandomIndex(weights);
      policyScore = selectionPropensity(weights, selectedIndex);
      policy = SPIN_POLICY;
    }

    const selected = candidates[selectedIndex];

    // ------------------------------------------------------------------
    // 8. Catat penayangannya — SETIAP penayangan, bukan hanya yang diterima.
    //
    //    Konteksnya dibekukan di sini, saat hasilnya benar-benar diperlihatkan.
    //    Kegagalan pencatatan tidak boleh membatalkan spin yang sudah berhasil:
    //    yang hilang cuma satu baris data, bukan makan siang orang.
    // ------------------------------------------------------------------
    const eventId = session_id
      ? await recordSpinEvent({
          sessionId: session_id,
          restaurantId: selected.id,
          userLat,
          userLng,
          distanceMeters: selected.distance,
          candidateCount: candidates.length,
          candidateIds: candidates.map((candidate) => candidate.id),
          candidateDistancesM: candidates.map((candidate) => candidate.distance),
          policy,
          policyScore,
          latencyMs: Date.now() - startedAt,
          isRaining,
        })
      : null;

    // Penyegaran cuaca dilepas setelah nilainya dibaca, jadi ia hanya
    // menyiapkan spin BERIKUTNYA dan tidak pernah menahan yang ini.
    if (needsRefresh(userLat, userLng)) {
      void refreshWeather(userLat, userLng);
    }

    // ------------------------------------------------------------------
    // 9. Return success response with the 6 required fields
    // ------------------------------------------------------------------
    return Response.json(
      {
        data: {
          id: selected.id,
          name: selected.name,
          category: selected.category,
          price_tier: selected.price_tier,
          distance: selected.distance,
          hygiene_score: selected.hygiene_score,
          is_open: selected.is_open,
        },
        // Dipakai klien untuk melaporkan respons atas penayangan INI.
        // `null` berarti tidak tercatat — tombolnya tetap berfungsi, cuma
        // tidak ada label reward yang tersimpan.
        event_id: eventId,
      },
      { status: 200, headers: rateLimitHeaders(limit, RATE_LIMIT) }
    );
  } catch (error) {
    // ------------------------------------------------------------------
    // 9. Catch-all: unexpected errors → INTERNAL_ERROR
    // ------------------------------------------------------------------
    const message = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/spin] Unexpected error:", message);
    return Response.json(
      {
        error: `Internal server error: ${message}`,
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}
