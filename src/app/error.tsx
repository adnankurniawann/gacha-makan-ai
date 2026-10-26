"use client";

/**
 * Error boundary untuk seluruh route di bawah app/.
 *
 * Tanpa ini, satu komponen yang melempar error membuat seluruh halaman jadi
 * putih — dan halaman putih adalah aplikasi yang ditutup dan tidak dibuka lagi.
 * Di sini pengguna tetap melihat sesuatu dan punya jalan keluar.
 */

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Pesan error tidak ditampilkan ke pengguna: isinya bisa membocorkan
    // struktur database atau detail internal lain.
    console.error("[app/error]", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-slate-50 font-sans text-slate-800 flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <div className="text-5xl mb-5" aria-hidden="true">
          🍜
        </div>

        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Ada yang tumpah di dapur
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Bagian ini gagal dimuat. Biasanya sekali coba lagi sudah beres.
        </p>

        <div className="mt-7 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={reset}
            className="w-full rounded-xl bg-rose-500 px-5 py-3 text-sm font-semibold text-white transition-transform active:scale-95 hover:bg-rose-600"
          >
            Coba lagi
          </button>
          <Link
            href="/"
            className="w-full rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100"
          >
            Kembali ke beranda
          </Link>
        </div>

        {error.digest && (
          <p className="mt-6 font-mono text-[10px] uppercase tracking-widest text-slate-300">
            ref {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
