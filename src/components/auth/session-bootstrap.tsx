"use client";

import { useEffect } from "react";

/**
 * Menyiapkan sesi anonim satu kali saat aplikasi dibuka.
 *
 * Tidak merender apa pun dan tidak menahan apa pun. Halaman tetap muncul dan
 * bisa dipakai selagi ini berjalan di latar — kalau gagal, yang hilang cuma
 * pencatatan riwayat, bukan kemampuan spin.
 *
 * Modul sesinya diimpor secara dinamis, bukan di atas berkas. Komponen ini
 * dipasang di root layout, jadi impor statis akan menyeret seluruh klien
 * Supabase (~60 kB terkirim) ke bundle awal SETIAP halaman — termasuk /spin
 * dan /map yang sebenarnya tidak membutuhkannya untuk tampil. Diimpor begini,
 * ia jatuh ke chunk terpisah yang diambil setelah halaman siap.
 */
export function SessionBootstrap() {
  useEffect(() => {
    void import("@/lib/supabase/session").then((mod) => mod.ensureSession());
  }, []);

  return null;
}
