"use client";

import { useEffect, useState } from "react";

/**
 * Panduan penggunaan, di paling atas.
 *
 * Sebelumnya panduan ini ada di dasar kolom kanan — di bawah statistik, feed
 * laporan, dan tiga kartu mode. Orang yang baru pertama membuka aplikasi
 * justru yang paling butuh, dan justru mereka yang tidak akan menggulir
 * sejauh itu.
 *
 * Bentuknya rata dan padat: tiga langkah bernomor dalam satu baris, tanpa
 * kotak berlapis. Panduan yang memakan setengah layar akan ditutup orang
 * sebelum dibaca.
 *
 * TIDAK punya tombol spin sendiri. Tombolnya sudah ada di atas halaman, dan
 * dua tombol menuju tempat yang sama membuat orang berhenti sebentar untuk
 * menebak apakah keduanya benar-benar sama.
 */

const STORAGE_KEY = "gacha-makan:panduan-ditutup";

const STEPS = [
  {
    n: 1,
    title: "Atur budget & jarak",
    body: "Dua slider, sesuai isi dompet.",
  },
  {
    n: 2,
    title: "Tekan SPIN",
    body: "Dapat satu warung, bukan daftar.",
  },
  {
    n: 3,
    title: "Kasih tahu hasilnya",
    body: "Jadi ke sana, simpan, atau spin lagi.",
  },
] as const;

export function UsageGuide({
  /** Pengguna yang belum pernah spin selalu melihatnya terbuka. */
  forceOpen = false,
}: {
  forceOpen?: boolean;
}) {
  // Dimulai terbuka, lalu ditutup setelah mount kalau memang pernah ditutup.
  // Kebalikannya membuat panduan berkedip muncul untuk yang sudah menutupnya.
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Harus lewat effect, bukan lazy useState: halaman ini dirender di server,
    // dan membaca localStorage saat render awal membuat HTML hasil hidrasi
    // berbeda dari yang dikirim server.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (forceOpen) {
      setReady(true);
      return;
    }

    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") setOpen(false);
    } catch {
      // Storage diblokir; panduannya tetap tampil. Kegagalan yang aman.
    }
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [forceOpen]);

  const close = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Ia akan muncul lagi lain kali.
    }
  };

  const reopen = () => {
    setOpen(true);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Sama.
    }
  };

  // Ruangnya ditahan sebelum localStorage terbaca, supaya isi di bawahnya
  // tidak melompat begitu panduannya menutup.
  if (!ready) return <div className="h-[108px]" aria-hidden="true" />;

  if (!open) {
    return (
      <button
        type="button"
        onClick={reopen}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
      >
        <span className="text-sm font-semibold text-slate-600">Cara pakai</span>
        <span className="text-xs font-medium text-rose-500">Lihat</span>
      </button>
    );
  }

  return (
    <section
      aria-label="Cara pakai"
      className="rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">
            Bingung mau makan apa?
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Tiga langkah. Nggak perlu daftar.
          </p>
        </div>

        {!forceOpen && (
          <button
            type="button"
            onClick={close}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            Tutup
          </button>
        )}
      </div>

      <ol className="mt-3 grid gap-2.5 sm:grid-cols-3">
        {STEPS.map((step) => (
          <li key={step.n} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-50 text-[11px] font-semibold text-rose-500">
              {step.n}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-slate-800">
                {step.title}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                {step.body}
              </span>
            </span>
          </li>
        ))}
      </ol>

    </section>
  );
}
