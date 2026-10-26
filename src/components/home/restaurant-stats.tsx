import { AlertTriangle, ShieldCheck, Store } from "lucide-react";

import { getRestaurantStats } from "@/lib/supabase/queries";

/**
 * Ringkasan isi katalog.
 *
 * Kembali berwarna supaya terlihat, tapi warnanya dijaga tetap di dalam palet
 * aplikasi. Versi sebelumnya memakai gradien indigo-biru yang tidak ada di
 * mana pun selain di kartu itu, dan hasilnya ia jadi hal paling mencolok di
 * halaman — mengalahkan tombol spin yang justru alasan aplikasi ini ada.
 *
 * Sekarang: latar berwarna lembut dengan teks pekat, bukan gradien pekat
 * dengan teks putih. Cukup menonjol untuk ditemukan, tidak cukup keras untuk
 * bersaing dengan aksi utama.
 */

const CARDS = [
  {
    key: "total",
    label: "Terdata",
    hint: "warung di katalog",
    icon: Store,
    surface: "bg-slate-50 border-slate-200",
    badge: "bg-white text-slate-500 border-slate-200",
    value: "text-slate-900",
  },
  {
    key: "safe",
    label: "Aman",
    hint: "skor kebersihan baik",
    icon: ShieldCheck,
    surface: "bg-emerald-50 border-emerald-200",
    badge: "bg-white text-emerald-600 border-emerald-200",
    value: "text-emerald-700",
  },
  {
    key: "redFlag",
    label: "Perlu dicek",
    hint: "ada laporan masuk",
    icon: AlertTriangle,
    surface: "bg-rose-50 border-rose-200",
    badge: "bg-white text-rose-500 border-rose-200",
    value: "text-rose-600",
  },
] as const;

export function RestaurantStatsSkeleton() {
  return (
    <div className="grid animate-pulse grid-cols-3 gap-2.5">
      {CARDS.map((card) => (
        <div
          key={card.key}
          className={`rounded-xl border p-3.5 ${card.surface}`}
        >
          <div className="h-8 w-8 rounded-lg bg-white/70" />
          <div className="mt-3 h-7 w-10 rounded bg-white/70" />
          <div className="mt-1.5 h-2.5 w-14 rounded bg-white/60" />
        </div>
      ))}
    </div>
  );
}

export async function RestaurantStatsCards() {
  const stats = await getRestaurantStats();
  const values: Record<string, number> = {
    total: stats.total,
    safe: stats.safe,
    redFlag: stats.redFlag,
  };

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {CARDS.map((card) => (
        <div
          key={card.key}
          className={`rounded-xl border p-3.5 transition-transform hover:-translate-y-0.5 ${card.surface}`}
        >
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg border ${card.badge}`}
          >
            <card.icon className="h-4 w-4" aria-hidden="true" />
          </span>

          <p
            className={`mt-2.5 text-2xl font-semibold leading-none tabular-nums ${card.value}`}
          >
            {values[card.key]}
          </p>
          <p className="mt-1.5 text-xs font-medium text-slate-700">
            {card.label}
          </p>
          <p className="mt-0.5 text-[11px] leading-tight text-slate-500">
            {card.hint}
          </p>
        </div>
      ))}
    </div>
  );
}
