"use client";

import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase/client";

/**
 * Sesi anonim: identitas tanpa pendaftaran.
 *
 * Setiap layar login sebelum nilainya terasa memotong konversi drastis. Orang
 * datang lapar, bukan ingin membuat akun. Jadi sesi dibuat diam-diam di latar,
 * dan akun baru ditawarkan saat ada yang benar-benar perlu disimpan.
 *
 * Sesi anonim tetap punya `user_id` sungguhan, jadi riwayat spin tercatat utuh
 * sejak spin pertama — itu yang nanti jadi data latih model rekomendasi. Kalau
 * user mendaftar belakangan, `user_id`-nya tidak berubah dan riwayatnya ikut.
 */

let inFlight: Promise<Session | null> | null = null;

/**
 * Mengembalikan sesi yang ada, atau membuat sesi anonim baru.
 *
 * Mengembalikan `null` — bukan melempar — kalau sesi tidak bisa dibuat.
 * Menjelajah dan spin tidak butuh login sama sekali, jadi kegagalan di sini
 * tidak boleh menghalangi siapa pun memakai aplikasinya.
 */
export async function ensureSession(): Promise<Session | null> {
  // Beberapa komponen memanggil ini bersamaan saat halaman dibuka. Tanpa
  // penjaga, tiap pemanggil akan membuat user anonim sendiri-sendiri.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) return data.session;

      const { data: created, error } = await supabase.auth.signInAnonymously();

      if (error) {
        // Paling sering: "Anonymous sign-ins are disabled" karena belum
        // dinyalakan di Supabase Dashboard → Authentication → Providers.
        console.warn(
          `[ensureSession] Sesi anonim tidak bisa dibuat: ${error.message}. ` +
            "Aplikasi tetap jalan, tapi riwayat tidak tercatat.",
        );
        return null;
      }

      return created.session;
    } catch (error) {
      console.warn("[ensureSession] Gagal menyiapkan sesi:", error);
      return null;
    } finally {
      // Dilepas supaya percobaan berikutnya (misalnya setelah jaringan pulih)
      // tidak selamanya memakai hasil gagal yang sama.
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * `true` kalau sesi ini belum terikat ke email mana pun.
 *
 * Dipakai untuk memutuskan kapan menawarkan pembuatan akun: hanya saat ada
 * yang benar-benar akan hilang kalau perangkatnya berganti.
 */
export function isAnonymous(session: Session | null): boolean {
  if (!session) return false;
  return session.user.is_anonymous === true;
}

/**
 * Mengikat email ke sesi anonim yang sedang berjalan.
 *
 * Bukan pendaftaran baru: `user_id`-nya tetap sama, jadi riwayat dan favorit
 * yang sudah terkumpul ikut terbawa. Supabase mengirim link konfirmasi, dan
 * emailnya baru benar-benar terpasang setelah link itu dibuka.
 */
export async function linkEmailToSession(
  email: string,
  redirectTo: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: redirectTo },
  );

  return { error: error?.message ?? null };
}
