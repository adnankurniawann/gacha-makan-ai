import Link from "next/link";

import { AppHeader } from "@/components/home/app-header";
import { Bookmark, History, Star } from "lucide-react";
import { BottomNav } from "@/components/home/bottom-nav";
import { Card, SectionHeader } from "@/components/ui/surface";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Riwayat spin dan daftar simpanan.
 *
 * Dua dari tiga fitur retensi yang direncanakan; filter tersimpan sudah hidup
 * di halaman spin lewat localStorage. Jangan tambah yang keempat sebelum
 * ketiganya terbukti terpakai.
 *
 * Dirender di server dengan sesi pengguna, jadi RLS yang menentukan apa yang
 * terlihat — bukan filter di kueri ini. Filter di sini hanya membuat maksudnya
 * terbaca tanpa harus membuka file policy.
 */

export const metadata = {
  title: "Riwayat | Gacha Makan",
  description: "Spin yang pernah kamu jalankan dan tempat yang kamu simpan.",
};

// Riwayat berubah tiap spin; tidak ada yang layak di-cache di sini.
export const dynamic = "force-dynamic";

interface HistoryRow {
  id: string;
  shown_at: string;
  action: string | null;
  distance_km: number;
  restaurants: { id: string; name: string; category: string | null } | null;
}

interface FavoriteRow {
  created_at: string;
  restaurants: { id: string; name: string; category: string | null } | null;
}

const ACTION_LABEL: Record<string, string> = {
  accepted: "Jadi ke sini",
  saved: "Disimpan",
  respun: "Spin lagi",
  ignored: "Nggak direspons",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function RiwayatPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Halaman ini hampir selalu kosong bagi pengunjung baru, dan keadaan kosong
  // yang cuma berbunyi "sesi belum siap" terbaca seperti halaman rusak atau
  // belum jadi. Jadi ia menjelaskan apa yang AKAN muncul di sini, bukan
  // melaporkan kegagalan.
  if (!user) {
    return (
      <main className="min-h-screen bg-slate-100 pb-24 font-sans text-slate-800 md:pb-12">
        <AppHeader session={false} />
        <div className="mx-auto max-w-md px-4 pt-10 text-center md:px-6">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50">
            <History className="h-6 w-6 text-rose-500" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">
            Belum ada yang tercatat
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Setiap kali kamu spin, hasilnya muncul di sini — termasuk tempat
            yang kamu simpan buat nanti.
          </p>
          <Link
            href="/spin"
            className="mt-6 inline-block rounded-xl bg-rose-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-rose-600"
          >
            Spin pertama kamu
          </Link>
        </div>
        <BottomNav />
      </main>
    );
  }

  const [historyResult, favoriteResult] = await Promise.all([
    supabase
      .from("spin_events")
      .select("id, shown_at, action, distance_km, restaurants(id, name, category)")
      .order("shown_at", { ascending: false })
      .limit(30),
    supabase
      .from("favorites")
      .select("created_at, restaurants(id, name, category)")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const history = (historyResult.data ?? []) as unknown as HistoryRow[];
  const favorites = (favoriteResult.data ?? []) as unknown as FavoriteRow[];

  return (
    <main className="min-h-screen bg-slate-100 pb-24 font-sans text-slate-800 md:pb-10">
      <AppHeader session={false} />
      <div className="mx-auto max-w-2xl px-4 pt-4 md:px-6">
        <section className="mb-4">
          <SectionHeader title="Tersimpan" action="Spin lagi" actionHref="/spin" />

          {favorites.length === 0 ? (
            <Card className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                <Bookmark className="h-4 w-4 text-slate-400" aria-hidden="true" />
              </span>
              <p className="text-[13px] leading-relaxed text-slate-500">
                Belum ada. Tekan &ldquo;Simpan buat nanti&rdquo; di hasil spin,
                dan tempatnya muncul di sini.
              </p>
            </Card>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {favorites.map((row) => (
                <li
                  key={row.restaurants?.id ?? row.created_at}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                >
                  <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                    <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" />
                    {row.restaurants?.name ?? "Tempat tidak dikenal"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {row.restaurants?.category ?? "Umum"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionHeader title="Spin terakhir" />

          {history.length === 0 ? (
            <Card className="flex items-center justify-between gap-3">
              <p className="text-[13px] leading-relaxed text-slate-500">
                Belum ada spin yang tercatat.
              </p>
              <Link
                href="/spin"
                className="shrink-0 rounded-lg bg-rose-500 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-600"
              >
                Spin
              </Link>
            </Card>
          ) : (
            <ul className="space-y-2">
              {history.map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-800">
                      {row.restaurants?.name ?? "Tempat tidak dikenal"}
                    </p>
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {formatWhen(row.shown_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {/* action null berarti jendela responsnya belum habis —
                        beda dari sudah diabaikan. */}
                    {row.action
                      ? (ACTION_LABEL[row.action] ?? row.action)
                      : "Menunggu"}{" "}
                    · {Number(row.distance_km).toFixed(1)} km
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <BottomNav />
    </main>
  );
}
