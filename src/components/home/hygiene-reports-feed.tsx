import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import {
  getRecentHygieneReports,
  type RecentHygieneReport,
} from "@/lib/supabase/queries";

function formatRelativeTime(value: string): string {
  const createdAt = new Date(value);
  const diffMs = Date.now() - createdAt.getTime();

  if (Number.isNaN(createdAt.getTime())) {
    return "Baru saja";
  }

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  if (diffMinutes < 1) return "Baru saja";
  if (diffMinutes < 60) return `${diffMinutes} menit yang lalu`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} jam yang lalu`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} hari yang lalu`;

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(createdAt);
}

function getReportPreview(report: RecentHygieneReport): string {
  const trimmed = report.description?.trim();
  if (trimmed) {
    return `"${trimmed}"`;
  }

  return report.report_type === "RED_FLAG"
    ? "Laporan red flag dari komunitas."
    : "Laporan kondisi bersih dari komunitas.";
}

function ReportItem({
  report,
  isLast,
}: {
  report: RecentHygieneReport;
  isLast: boolean;
}) {
  const isRedFlag = report.report_type === "RED_FLAG";

  return (
    <Link
      href={`/map?restaurant_id=${encodeURIComponent(report.restaurant_id)}`}
      className={`group flex gap-3.5 items-start px-5 py-4 transition-colors hover:bg-slate-50/50 ${
        isLast ? "" : "border-b border-slate-50"
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm ${
          isRedFlag
            ? "border-red-100 bg-red-50 text-red-500"
            : "border-emerald-100 bg-emerald-50 text-emerald-500"
        }`}
      >
        {isRedFlag ? (
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4
          className={`truncate text-sm font-semibold text-slate-800 ${
            isRedFlag ? "group-hover:text-red-600" : "group-hover:text-emerald-600"
          }`}
        >
          {report.restaurant_name}
        </h4>
        <p className="mt-1 text-xs font-normal leading-relaxed text-slate-500 line-clamp-3">
          {getReportPreview(report)}
        </p>
        <p
          className={`mt-2 text-[10px] font-medium uppercase tracking-wide ${
            isRedFlag ? "text-red-400" : "text-emerald-500"
          }`}
        >
          {formatRelativeTime(report.created_at)}
        </p>
        {!isRedFlag && report.is_verified_safe ? (
          <div className="mt-2 inline-block rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-[9px] font-semibold uppercase tracking-widest text-emerald-600">
            Verified
          </div>
        ) : null}
      </div>
    </Link>
  );
}

export function HygieneReportsFeedSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="animate-pulse border-b border-slate-50 bg-slate-50/50 px-5 py-4">
        <div className="h-4 w-32 rounded bg-slate-200" />
      </div>
      <div className="flex flex-col">
      {[0, 1].map((index) => (
        <div
          key={index}
          className="flex animate-pulse gap-3.5 border-b border-slate-50 px-5 py-4 last:border-b-0"
        >
          <div className="h-9 w-9 shrink-0 rounded-xl bg-slate-100" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-slate-100" />
            <div className="h-3 w-full rounded bg-slate-100" />
            <div className="h-2 w-1/4 rounded bg-slate-100" />
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

export async function HygieneReportsFeed() {
  const reports = await getRecentHygieneReports(5);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-50 bg-slate-50/50 px-5 py-4">
        <h3 className="text-sm font-semibold tracking-tight text-slate-800">
          Laporan Higienitas
        </h3>
        <Link
          href="/map"
          className="text-xs font-medium uppercase tracking-wider text-rose-500 transition-colors hover:text-rose-600"
        >
          Lihat Peta
        </Link>
      </div>

      {reports.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm font-medium text-slate-600">
            Belum ada laporan higienitas.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Kirim laporan pertama lewat halaman peta.
          </p>
          <Link
            href="/map"
            className="mt-4 inline-block text-xs font-semibold text-rose-500 hover:text-rose-600"
          >
            Buka peta
          </Link>
        </div>
      ) : (
        reports.map((report, index) => (
          <ReportItem
            key={report.id}
            report={report}
            isLast={index === reports.length - 1}
          />
        ))
      )}
    </div>
  );
}
