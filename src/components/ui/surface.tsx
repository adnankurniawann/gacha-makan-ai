import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Primitif tampilan bersama.
 *
 * Dua perubahan yang paling menentukan wajahnya:
 *
 * 1. Ikonnya komponen `lucide-react`, bukan emoji. Emoji tampil berbeda di
 *    tiap sistem operasi, tidak bisa diwarnai, dan ukurannya tidak pernah
 *    sejajar dengan teks di sebelahnya.
 * 2. Bobot hurufnya turun. Sebelumnya hampir semua teks `font-bold` atau
 *    lebih tebal; kalau semuanya ditebalkan, tidak ada yang menonjol.
 */

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white ${padded ? "p-4" : ""} ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionHeader({
  title,
  action,
  actionHref,
}: {
  title: string;
  action?: string;
  actionHref?: string;
}) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">
        {title}
      </h2>
      {action && actionHref && (
        <Link
          href={actionHref}
          className="shrink-0 text-xs font-medium text-rose-500 transition-colors hover:text-rose-600"
        >
          {action}
        </Link>
      )}
    </div>
  );
}

/** Petak ikon untuk aksi cepat. Label pendek, tanpa deskripsi. */
export function IconTile({
  href,
  icon: Icon,
  label,
  tone = "rose",
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  tone?: "rose" | "sky" | "amber" | "slate" | "emerald";
}) {
  const tones: Record<string, string> = {
    rose: "bg-rose-50 text-rose-500",
    sky: "bg-sky-50 text-sky-500",
    amber: "bg-amber-50 text-amber-600",
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-50 text-emerald-600",
  };

  return (
    <Link
      href={href}
      className="group flex flex-col items-center gap-2 rounded-lg py-2 transition-colors hover:bg-slate-50"
    >
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-xl transition-transform group-active:scale-90 ${tones[tone]}`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="text-center text-xs font-medium leading-tight text-slate-600">
        {label}
      </span>
    </Link>
  );
}

/** Satu baris menu: ikon, label, keterangan opsional, tanda panah. */
export function MenuRow({
  href,
  onClick,
  icon: Icon,
  label,
  hint,
  danger = false,
}: {
  href?: string;
  onClick?: () => void;
  icon: LucideIcon;
  label: string;
  hint?: string;
  danger?: boolean;
}) {
  const content = (
    <>
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          danger ? "bg-rose-50 text-rose-500" : "bg-slate-100 text-slate-500"
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-sm font-medium ${danger ? "text-rose-600" : "text-slate-800"}`}
        >
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block truncate text-xs text-slate-400">
            {hint}
          </span>
        )}
      </span>
      <span className="shrink-0 text-lg leading-none text-slate-300" aria-hidden="true">
        ›
      </span>
    </>
  );

  const className =
    "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100";

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

export function MenuList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {children}
    </div>
  );
}
