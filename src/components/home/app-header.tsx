"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Header dengan navigasi yang sama di seluruh halaman.
 *
 * Rata dan tipis: garis bawah setipis mungkin, tanpa bayangan tebal. Di layar
 * sempit tautan navigasinya disembunyikan karena sudah ada `BottomNav` —
 * menaruh menu yang sama dua kali cuma memakan tinggi layar yang berharga.
 */

const LINKS = [
  { href: "/spin", label: "Spin" },
  { href: "/map", label: "Peta" },
  { href: "/dompet", label: "Dompet" },
  { href: "/riwayat", label: "Riwayat" },
];

export function AppHeader({
  displayName,
  isAnonymous,
  /**
   * Halaman klien memanggilnya tanpa data sesi.
   *
   * Membaca sesi dari sana berarti menarik klien Supabase ke bundle awal
   * halaman spin — persis yang dikeluarkan di Fase C, dan halaman itu yang
   * paling sering dibuka di 4G goyah.
   */
  session = true,
}: {
  displayName?: string | null;
  isAnonymous?: boolean;
  session?: boolean;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-2.5 md:px-6">
        <Link href="/" className="shrink-0">
          <span className="text-lg font-bold tracking-tight text-slate-900">
            Gacha<span className="text-rose-500">Makan</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-rose-50 text-rose-600"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Sesi anonim TIDAK ditampilkan seolah sudah punya akun. */}
        {!session ? (
          <Link
            href="/account"
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-rose-200 hover:text-rose-600"
          >
            Akun
          </Link>
        ) : isAnonymous || !displayName ? (
          <Link
            href="/login"
            className="shrink-0 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-600"
          >
            Masuk
          </Link>
        ) : (
          <Link
            href="/account"
            className="flex shrink-0 items-center gap-2 transition-transform active:scale-95"
          >
            <span className="hidden max-w-[10ch] truncate text-sm font-semibold text-slate-700 sm:inline">
              {displayName}
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-sm font-semibold text-white">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
          </Link>
        )}
      </div>
    </header>
  );
}
