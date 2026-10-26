import Link from "next/link";

import { AuthPanel } from "@/components/auth/auth-panel";
import { AppHeader } from "@/components/home/app-header";

export const metadata = {
  title: "Masuk | Gacha Makan",
  description: "Simpan riwayat dan favoritmu dengan satu link ke email.",
};

type LoginPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

/**
 * Halaman masuk.
 *
 * Sengaja pendek. Masuk itu OPSIONAL di aplikasi ini — orang sudah bisa spin
 * tanpa akun — jadi halaman ini tidak boleh terasa seperti penghalang. Satu
 * kalimat alasan, satu kolom isian, satu tombol, satu jalan keluar.
 *
 * Daftar manfaat yang panjang justru membuatnya terasa seperti sedang
 * membujuk, dan yang sedang dibujuk cenderung menutup halaman.
 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const authCallbackFailed = params.error === "auth_callback_failed";
  const callbackMessage = params.message;

  return (
    <main className="min-h-screen bg-slate-100 pb-16 font-sans text-slate-800">
      <AppHeader session={false} />

      <div className="mx-auto w-full max-w-sm px-4 pt-12 md:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Simpan punyamu
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
          Riwayat spin dan daftar simpanan ikut terbawa, bahkan kalau kamu ganti
          HP.
        </p>

        {authCallbackFailed ? (
          <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {callbackMessage ??
              "Link dari email gagal dipakai. Coba kirim ulang."}
          </div>
        ) : null}

        <div className="mt-6">
          <AuthPanel className="border-0 bg-transparent p-0 shadow-none" />
        </div>

        <p className="mt-4 text-xs leading-relaxed text-slate-400">
          Tanpa password. Kami kirim satu link ke emailmu, tinggal dibuka. Email
          apa pun bisa — tidak harus email kampus.
        </p>

        <Link
          href="/spin"
          className="mt-8 block text-center text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
        >
          Nanti aja, mau spin dulu
        </Link>
      </div>
    </main>
  );
}
