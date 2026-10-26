import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Pencatatan spin_events. Hanya dipakai dari route handler.
 *
 * Dipakai dari server, bukan dari klien, karena dua alasan. Pertama, klien
 * `supabase-js` tidak boleh masuk bundle halaman spin — Fase C sengaja
 * mengeluarkannya. Kedua, nilai seperti jarak dan jumlah kandidat berasal dari
 * hasil query PostGIS; mengirimkannya ke browser lalu menerimanya kembali
 * hanya membuka jalan bagi angka yang tidak sesuai kenyataan.
 */

export interface SpinEventContext {
  sessionId: string;
  restaurantId: string;
  userLat: number;
  userLng: number;
  /** Meter, seperti yang ditampilkan ke pengguna. */
  distanceMeters: number;
  /** Berapa kandidat yang lolos filter saat penayangan ini. */
  candidateCount: number;
  policy: string;
  /**
   * Peluang kebijakan memilih kandidat ini, dalam (0, 1].
   *
   * Inilah yang membuat log ini bisa dipakai untuk evaluasi off-policy yang
   * jujur. Pemilihan kita berbobot, bukan seragam, jadi tanpa angka ini
   * evaluasi apa pun akan mewarisi bias yang tidak bisa ditaksir besarnya.
   */
  policyScore: number;
  /** Lama pemrosesan permintaan, untuk metrik p95. */
  latencyMs: number;
  /**
   * Cuaca saat penayangan. `null` berarti **tidak tahu**, bukan "tidak hujan".
   *
   * Perbedaan itu harus dipertahankan sampai ke database: mengisi `false` saat
   * sebenarnya tidak tahu berarti menanam fitur palsu ke dalam data latih.
   */
  isRaining: boolean | null;

  /**
   * Seluruh kandidat yang lolos filter, termasuk yang tidak terpilih.
   *
   * Tanpa arm set, evaluasi replay di Fase 4 mustahil: tidak ada cara
   * menanyakan apa yang AKAN dipilih kebijakan lain pada konteks yang sama.
   * Dicatat sekarang karena tidak bisa direkonstruksi belakangan.
   */
  candidateIds: string[];
  /** Jarak tiap kandidat dalam meter, sejajar indeks dengan candidateIds. */
  candidateDistancesM: number[];
}

/** Konteks spin yang berakhir tanpa kandidat sama sekali. */
export interface SpinMissContext {
  sessionId: string;
  userLat: number;
  userLng: number;
  radiusMeters: number;
  budget: number;
  onlyOpen: boolean;
  wideningHelps: boolean;
  budgetHelps: boolean;
  closedOnly: boolean;
}

const JAKARTA_TIME_ZONE = "Asia/Jakarta";

/**
 * Konteks waktu lokal saat penayangan, dibekukan sebagai angka.
 *
 * Dihitung di sini, bukan diturunkan dari `shown_at` saat analisis. Menghitung
 * ulang belakangan berarti memakai aturan zona waktu yang berlaku hari itu
 * atas peristiwa yang sudah lewat, dan membuat fitur model berbeda dari yang
 * berlaku saat keputusannya diambil.
 */
export function localTimeContext(at: Date): {
  hourLocal: number;
  dayOfWeek: number;
  isWeekend: boolean;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: JAKARTA_TIME_ZONE,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(at);

  const hourPart = parts.find((part) => part.type === "hour")?.value ?? "0";
  const weekdayPart = parts.find((part) => part.type === "weekday")?.value ?? "Sun";

  // 0 = Minggu, sama dengan extract(dow) di Postgres dan Date.getDay().
  const weekdayIndex: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  // Intl memakai 24 untuk tengah malam di sebagian runtime.
  const hourLocal = Number(hourPart) % 24;
  const dayOfWeek = weekdayIndex[weekdayPart] ?? 0;

  return {
    hourLocal,
    dayOfWeek,
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
  };
}

/**
 * Mencatat satu penayangan hasil spin.
 *
 * Mengembalikan id barisnya, atau `null` kalau tidak tercatat. SETIAP
 * kegagalan di sini diserap: spin yang berhasil tidak boleh berubah jadi error
 * hanya karena logging-nya gagal. Yang hilang cuma satu baris data.
 *
 * Kasus `null` yang paling sering: pengunjung belum punya sesi karena
 * Anonymous sign-ins belum dinyalakan di Supabase Dashboard.
 */
export async function recordSpinEvent(
  context: SpinEventContext,
): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      // Tanpa user_id, barisnya tidak bisa dikaitkan ke siapa pun dan RLS
      // memang akan menolaknya.
      return null;
    }

    const shownAt = new Date();
    const { hourLocal, dayOfWeek, isWeekend } = localTimeContext(shownAt);

    const { data, error } = await supabase
      .from("spin_events")
      .insert({
        user_id: user.id,
        session_id: context.sessionId,
        restaurant_id: context.restaurantId,
        shown_at: shownAt.toISOString(),
        user_lat: context.userLat,
        user_lng: context.userLng,
        distance_km: Number((context.distanceMeters / 1000).toFixed(3)),
        hour_local: hourLocal,
        day_of_week: dayOfWeek,
        is_weekend: isWeekend,
        is_raining: context.isRaining,
        candidate_ids: context.candidateIds,
        candidate_distances_m: context.candidateDistancesM,
        policy: context.policy,
        policy_score: context.policyScore,
        candidate_n: context.candidateCount,
        latency_ms: context.latencyMs,
      })
      .select("id")
      .single();

    if (error) {
      console.warn("[recordSpinEvent] Gagal mencatat penayangan:", error.message);
      return null;
    }

    return (data as { id: string }).id;
  } catch (error) {
    console.warn("[recordSpinEvent] Gagal mencatat penayangan:", error);
    return null;
  }
}

/**
 * Mencatat spin yang berakhir tanpa kandidat.
 *
 * Ini kegagalan yang paling penting diketahui: ia menandai lubang cakupan data
 * di radius tertentu, dan orang yang mengalaminya kemungkinan besar tidak
 * kembali. Tanpa dicatat, ia tidak meninggalkan jejak apa pun.
 *
 * Seperti recordSpinEvent, semua kegagalan diserap.
 */
export async function recordSpinMiss(context: SpinMissContext): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { error } = await supabase.from("spin_misses").insert({
      user_id: user.id,
      session_id: context.sessionId,
      user_lat: context.userLat,
      user_lng: context.userLng,
      radius_m: context.radiusMeters,
      budget: context.budget,
      only_open: context.onlyOpen,
      widening_helps: context.wideningHelps,
      budget_helps: context.budgetHelps,
      closed_only: context.closedOnly,
    });

    if (error) {
      console.warn("[recordSpinMiss] Gagal mencatat:", error.message);
    }
  } catch (error) {
    console.warn("[recordSpinMiss] Gagal mencatat:", error);
  }
}

export type SpinAction = "accepted" | "respun" | "saved";

/**
 * Mencatat respons pengguna atas satu penayangan.
 *
 * Lewat fungsi database `record_spin_action`, bukan UPDATE langsung: klien
 * memang tidak punya hak update ke tabel ini, dan aturan "respons pertama yang
 * menang" dipaksakan di sisi database supaya tidak bisa dilewati.
 *
 * `false` berarti tidak ada yang berubah — biasanya karena baris itu sudah
 * punya respons. Itu bukan error.
 */
export async function recordSpinAction(
  eventId: string,
  action: SpinAction,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("record_spin_action", {
    p_event_id: eventId,
    p_action: action,
  });

  if (error) {
    console.warn("[recordSpinAction] Gagal mencatat respons:", error.message);
    return false;
  }

  return data === true;
}
