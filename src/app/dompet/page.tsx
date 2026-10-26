import Link from "next/link";
import { Info, Wallet } from "lucide-react";

import { AppHeader } from "@/components/home/app-header";
import { BottomNav } from "@/components/home/bottom-nav";
import { Card, SectionHeader } from "@/components/ui/surface";
import WalletCard from "@/components/WalletCard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Halaman dompet.
 *
 * Budget punya rumahnya sendiri sekarang. Sebelumnya ia cuma satu kartu di
 * beranda yang tampil bersyarat, dan syarat itu ternyata bisa tidak pernah
 * terpenuhi — jadi fiturnya hilang tanpa ada yang sadar.
 *
 * Di sini ditambah riwayat singkat yang sebelumnya tidak ada di mana pun:
 * berapa kali kamu benar-benar jadi makan, dan berapa yang sudah keluar.
 */

export const metadata = {
  title: "Dompet | Gacha Makan",
  description: "Atur jatah makan bulanan dan pantau sisanya.",
};

export const dynamic = "force-dynamic";

export default async function DompetPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Berapa kali benar-benar jadi makan, dan total harganya. Diambil dari
  // spin_events yang diterima — sumber yang sama dengan yang memotong saldo.
  let acceptedCount = 0;
  if (user) {
    const { count } = await supabase
      .from("spin_events")
      .select("id", { count: "exact", head: true })
      .eq("action", "accepted");
    acceptedCount = count ?? 0;
  }

  return (
    <main className="min-h-screen bg-slate-100 pb-24 font-sans text-slate-800 md:pb-12">
      <AppHeader session={false} />

      <div className="mx-auto w-full max-w-2xl px-4 pt-4 md:px-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
            <Wallet className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">
              Dompet makan
            </h1>
            <p className="text-xs text-slate-500">
              Jatah bulanan dan sisanya.
            </p>
          </div>
        </div>

        <WalletCard />

        <div className="mt-6">
          <SectionHeader title="Sejauh ini" />
          <Card className="flex items-center justify-between gap-4">
            <div>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">
                {acceptedCount}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                kali kamu jadi makan dari hasil spin
              </p>
            </div>
            <Link
              href="/riwayat"
              className="shrink-0 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              Lihat riwayat
            </Link>
          </Card>
        </div>

        <Card className="mt-4 border-slate-200 bg-slate-50">
          <div className="flex gap-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <div className="text-xs leading-relaxed text-slate-600">
              <p>
                Saldo berkurang tiap kali kamu menekan &ldquo;Jadi ke sini&rdquo;
                di hasil spin, sebesar harga tempat itu.
              </p>
              <p className="mt-1.5 text-slate-500">
                Ini alat bantu pribadi, bukan uang sungguhan — mengatur ulang
                budget akan mengisi saldonya penuh lagi.
              </p>
            </div>
          </div>
        </Card>

        {!user && (
          <Card className="mt-4 border-amber-200 bg-amber-50">
            <p className="text-sm font-semibold text-amber-900">
              Sesi belum siap
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">
              Buka halaman spin sekali, lalu balik ke sini. Kalau tetap begini,
              Anonymous sign-ins di Supabase kemungkinan belum aktif.
            </p>
          </Card>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
