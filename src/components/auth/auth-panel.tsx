"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  ensureSession,
  isAnonymous,
  linkEmailToSession,
} from "@/lib/supabase/session";

/**
 * Panel email untuk masuk, atau untuk menyimpan sesi anonim jadi akun.
 *
 * Perbedaannya penting. Kalau sesi yang berjalan anonim, emailnya DIKAITKAN ke
 * user yang sudah ada lewat `updateUser`, bukan membuat user baru — dengan
 * begitu `user_id`-nya tidak berubah dan riwayat spin yang sudah terkumpul
 * ikut terbawa. Memakai `signInWithOtp` di situ akan membuang riwayat itu
 * diam-diam, dan itu persis data yang nanti melatih model rekomendasi.
 */
export function AuthPanel({ className }: { className?: string }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void ensureSession().then((session) => {
      if (!cancelled) setAnonymous(isAnonymous(session));
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAnonymous(isAnonymous(session));
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setMessage({ text: "Masukkan email dulu.", isError: true });
      return;
    }

    setLoading(true);
    setMessage(null);

    const redirectTo = `${window.location.origin}/auth/callback`;

    try {
      let errorMessage: string | null;

      if (anonymous) {
        errorMessage = (await linkEmailToSession(email, redirectTo)).error;
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo },
        });
        errorMessage = error?.message ?? null;
      }

      if (errorMessage) {
        setMessage({ text: errorMessage, isError: true });
      } else {
        setMessage({
          text: anonymous
            ? "Cek emailmu. Buka linknya, dan riwayat spin kamu ikut kesimpan."
            : "Link ajaib telah dikirim ke email kamu!",
          isError: false,
        });
      }
    } catch {
      setMessage({ text: "Terjadi kesalahan. Coba lagi.", isError: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`w-full ${className}`}>


      <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
        {/* Placeholder-nya email umum, bukan email kampus. Menulis
            "nama@kampus.ac.id" terbaca seperti syarat, dan orang yang tidak
            punya email kampus akan mengira ia tidak boleh ikut. Email apa pun
            bisa dipakai. */}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email kamu"
          autoComplete="email"
          required
          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-rose-500 px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Mengirim…" : anonymous ? "Simpan akun" : "Kirim link"}
        </button>
      </form>

      {/* Pesan Error / Sukses */}
      {message && (
        <div
          className={`mt-3 rounded-lg px-4 py-3 text-sm ${
            message.isError
              ? "border border-rose-200 bg-rose-50 text-rose-700"
              : "border border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
