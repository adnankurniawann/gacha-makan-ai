"use client";

import { useEffect } from "react";

/**
 * Mendaftarkan service worker supaya aplikasinya bisa dipasang ke home screen.
 *
 * Ini yang mengubah "situs yang pernah aku buka" jadi "aplikasi yang aku
 * punya" — ikon di home screen dibuka jauh lebih sering daripada tab yang
 * hilang di antara dua puluh tab lain. Murah dipasang, besar dampaknya pada
 * retensi.
 *
 * Pendaftaran ditunda sampai halaman selesai memuat: mendaftar lebih awal
 * membuat browser mengambil sw.js berbarengan dengan berkas yang benar-benar
 * dibutuhkan untuk menampilkan halaman, dan itu justru memperlambat hal yang
 * paling ingin kita percepat.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Service worker di development membuat perubahan kode tertutup cache
    // lama. Cukup di produksi.
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        // Gagal mendaftar bukan alasan mengganggu siapa pun: aplikasinya tetap
        // berjalan penuh, cuma tidak bisa dipasang.
        console.warn("[sw] Pendaftaran gagal:", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
