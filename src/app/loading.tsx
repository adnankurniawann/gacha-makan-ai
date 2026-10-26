/**
 * Loading state untuk navigasi antar route.
 *
 * Beranda menunggu sesi Supabase sebelum bisa dirender. Di 4G yang goyah,
 * jeda itu terasa — dan layar kosong tanpa penjelasan terbaca sebagai
 * aplikasi yang macet. Kerangka ini menahan tata letaknya supaya isinya
 * tidak melompat saat data datang.
 */
export default function Loading() {
  return (
    <main
      className="min-h-screen bg-slate-50 font-sans"
      aria-busy="true"
      aria-label="Memuat halaman"
    >
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-200/60 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-lg md:px-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl">
          Gacha<span className="text-rose-500">Makan</span>
        </h1>
        <div className="h-9 w-9 animate-pulse rounded-full bg-slate-200" />
      </header>

      <div className="space-y-4 px-4 py-6 md:px-8">
        <div className="h-32 animate-pulse rounded-2xl bg-slate-200/70" />
        <div className="grid grid-cols-3 gap-3">
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200/70" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200/70" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200/70" />
        </div>
        <div className="h-44 animate-pulse rounded-2xl bg-slate-200/70" />
      </div>

      <span className="sr-only">Memuat…</span>
    </main>
  );
}
