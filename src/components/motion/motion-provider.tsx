"use client";

import { LazyMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Memuat mesin animasi Framer Motion setelah halaman bisa dipakai.
 *
 * Konteks pemakaian nyata: berdiri di pinggir jalan, Android kelas menengah,
 * sinyal 4G goyah, jam 12 siang. Setiap kilobyte di bundle awal dibayar di
 * sana. Padahal animasi gacha baru relevan setelah orang menekan SPIN —
 * beberapa detik setelah halaman muncul.
 *
 * `LazyMotion` memisahkan fitur animasi ke chunk tersendiri yang diambil
 * belakangan. Komponen memakai `m.div` (kecil) alih-alih `motion.div` (menarik
 * seluruh mesin). Flag `strict` membuat pemakaian `motion.*` melempar error
 * saat development, jadi tidak ada yang tanpa sadar mengembalikan bobotnya ke
 * bundle awal.
 */
const loadAnimationFeatures = () =>
  import("framer-motion").then((mod) => mod.domAnimation);

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadAnimationFeatures} strict>
      {children}
    </LazyMotion>
  );
}
