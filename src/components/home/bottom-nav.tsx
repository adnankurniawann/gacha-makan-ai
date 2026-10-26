"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, Home, MapPin, Sparkles } from "lucide-react";

/**
 * Navigasi bawah untuk layar sempit.
 *
 * Konteks pemakaian nyata aplikasi ini adalah satu tangan sambil berdiri di
 * pinggir jalan. Menu di pojok atas layar 6 inci butuh jangkauan jempol yang
 * tidak semua orang punya; empat tujuan di dasar layar tidak.
 *
 * Disembunyikan di layar lebar, karena di sana navigasi header sudah cukup.
 */

const ITEMS = [
  { href: "/", label: "Beranda", icon: Home },
  { href: "/spin", label: "Spin", icon: Sparkles },
  { href: "/map", label: "Peta", icon: MapPin },
  { href: "/riwayat", label: "Riwayat", icon: History },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur-lg md:hidden"
    >
      <div className="mx-auto flex max-w-md items-stretch">
        {ITEMS.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors ${
                active ? "text-rose-500" : "text-slate-400"
              }`}
            >
              <item.icon className="h-5 w-5" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </div>
      {/* Ruang aman untuk HP dengan indikator gestur di dasar layar. */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
