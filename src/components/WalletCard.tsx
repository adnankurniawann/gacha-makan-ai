"use client";

import { useState, useEffect } from "react";
import { m } from "framer-motion";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { MotionProvider } from "@/components/motion/motion-provider";
import { supabase } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/session";

/**
 * Kartu dompet.
 *
 * SATU-SATUNYA permukaan gelap di aplikasi ini, dan itu disengaja. Uang
 * pantas terlihat berbeda dari kartu lain — dan karena hanya ada satu, ia
 * menonjol tanpa perlu berteriak. Kalau tiga kartu sekaligus dibuat mencolok,
 * tidak ada yang mencolok lagi.
 *
 * Gelap, bukan merah, supaya tidak bersaing dengan tombol spin. Rose tetap
 * warna aksi di seluruh halaman.
 *
 * CATATAN: kartu ini pernah disembunyikan di beranda dengan syarat "sudah
 * pernah spin". Kalau pencatatan spin belum jalan, syaratnya tidak pernah
 * terpenuhi dan seluruh fitur budgeting hilang tanpa jejak. Jangan
 * menyembunyikan fitur di balik syarat yang mungkin tidak pernah benar —
 * tampilkan bentuk ajakannya, jangan hilangkan pintunya.
 */
export default function WalletCard({
  /** Bentuk ringkas untuk beranda; bentuk penuh dipakai di halaman /dompet. */
  compact = false,
}: {
  compact?: boolean;
}) {
  const [balance, setBalance] = useState(0);
  const [budget, setBudget] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [newBudget, setNewBudget] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchWallet = async () => {
      const session = await ensureSession();
      if (!session) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("wallets")
        .select("monthly_budget, current_balance")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (data) {
        setBudget(data.monthly_budget);
        setBalance(data.current_balance);
      }
      setLoading(false);
    };

    fetchWallet();
  }, []);

  const handleSetBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    const budgetValue = parseInt(newBudget, 10);
    if (Number.isNaN(budgetValue) || budgetValue <= 0) return;

    const session = await ensureSession();
    if (!session) {
      setMessage("Sesi belum siap. Muat ulang halaman lalu coba lagi.");
      return;
    }

    const { error } = await supabase.from("wallets").upsert({
      user_id: session.user.id,
      monthly_budget: budgetValue,
      current_balance: budgetValue,
      last_updated: new Date().toISOString(),
    });

    if (error) {
      setMessage("Gagal menyimpan budget. Coba lagi.");
      return;
    }

    setBudget(budgetValue);
    setBalance(budgetValue);
    setIsEditing(false);
    setNewBudget("");
    setMessage(null);
  };

  const percentage =
    budget > 0 ? Math.max(0, Math.min(100, (balance / budget) * 100)) : 0;

  const barColor =
    percentage > 50 ? "bg-emerald-400" : percentage > 20 ? "bg-amber-400" : "bg-rose-400";

  const terpakai = Math.max(0, budget - balance);

  if (loading) {
    return <div className="h-32 animate-pulse rounded-xl bg-slate-200" />;
  }

  // --- Belum diatur: jelaskan gunanya, jangan sembunyikan --------------------
  if (budget <= 0 && !isEditing) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
            <Wallet className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">
              Atur budget makan
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Tentukan jatah bulanan, dan tiap kali kamu tekan &ldquo;Jadi ke
              sini&rdquo; saldonya otomatis berkurang.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
        >
          Atur sekarang
        </button>
      </div>
    );
  }

  return (
    <MotionProvider>
      <div className="overflow-hidden rounded-xl bg-slate-900 text-white">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <p className="text-xs text-slate-400">Sisa saldo makan</p>
              </div>

              {/* Angka besar dengan "Rp" yang mengecil — mata langsung jatuh
                  ke nominalnya, bukan ke satuannya. */}
              <p className="mt-1.5 flex items-baseline gap-1.5 tracking-tight">
                <span className="text-base font-medium text-slate-400">Rp</span>
                <span className="text-[2.5rem] font-semibold leading-none tabular-nums text-white">
                  {balance.toLocaleString("id-ID")}
                </span>
              </p>
            </div>

            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10"
            >
              {isEditing ? "Batal" : "Ubah"}
            </button>
          </div>

          {isEditing ? (
            <form onSubmit={handleSetBudget} className="mt-4 flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={newBudget}
                onChange={(e) => setNewBudget(e.target.value)}
                placeholder="Contoh: 500000"
                required
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-white/40"
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-600"
              >
                Simpan
              </button>
            </form>
          ) : (
            <div className="mt-5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <m.div
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ duration: 0.9, ease: "easeOut" }}
                  className={`h-full rounded-full ${barColor}`}
                />
              </div>

              <div className="mt-2.5 flex justify-between text-xs text-slate-400">
                <span>
                  Terpakai{" "}
                  <span className="tabular-nums text-slate-200">
                    Rp {terpakai.toLocaleString("id-ID")}
                  </span>
                </span>
                <span>
                  Jatah{" "}
                  <span className="tabular-nums text-slate-200">
                    Rp {budget.toLocaleString("id-ID")}
                  </span>
                </span>
              </div>

              {percentage <= 20 && (
                <p className="mt-3 rounded-lg bg-rose-500/15 px-3 py-2 text-xs font-medium text-rose-300">
                  Saldo menipis. Kurangi jajan mahal.
                </p>
              )}
            </div>
          )}

          {message && (
            <p className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-xs text-slate-200">
              {message}
            </p>
          )}
        </div>

        {compact && !isEditing && (
          <Link
            href="/dompet"
            className="block border-t border-white/10 px-5 py-3 text-xs font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            Kelola dompet
          </Link>
        )}
      </div>
    </MotionProvider>
  );
}
