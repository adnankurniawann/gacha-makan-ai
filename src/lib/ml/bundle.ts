/**
 * Berkas yang dibaca /api/spin: artefak model plus statistik yang dibekukan.
 *
 * Dipisah dari `ModelArtifact` supaya format artefaknya tidak berubah — tes
 * dan simulator tetap memakainya apa adanya — dan karena snapshot bukan bagian
 * dari model. Ia data yang kebetulan dibutuhkan saat penyajian: popularitas
 * restoran tidak bisa dihitung di route handler tanpa service_role.
 */

import type { PriorStats } from "@/lib/ml/features";
import { ModelLoadError, parseModelArtifact, type ModelArtifact } from "@/lib/ml/model";
import type { PriorSnapshot } from "@/lib/ml/training";

export const BUNDLE_FORMAT_VERSION = 1;

/**
 * Jumlah contoh minimum sebelum bundle boleh menyajikan.
 *
 * docs/PENGEMBANGAN-AI.md: di bawah ~500 spin tidak ada yang bisa dipelajari, dan model yang
 * dilatih dari segelintir baris hanya menghafal kebetulan.
 */
export const MIN_SERVING_EXAMPLES = 500;

export interface BanditBundle {
  bundleVersion: number;
  model: ModelArtifact;
  snapshot: PriorSnapshot;
  /**
   * `true` kalau dilatih dari data sintetis. Bundle seperti itu boleh dipakai
   * untuk mencoba alurnya secara lokal, tapi ditolak saat menyajikan kecuali
   * secara eksplisit diizinkan.
   */
  synthetic: boolean;
}

function isStats(value: unknown): value is PriorStats {
  if (value === null || typeof value !== "object") return false;
  const { impressions, accepts } = value as Record<string, unknown>;
  return (
    typeof impressions === "number" &&
    typeof accepts === "number" &&
    Number.isFinite(impressions) &&
    Number.isFinite(accepts) &&
    impressions >= 0 &&
    accepts >= 0 &&
    accepts <= impressions
  );
}

export function parseBanditBundle(raw: unknown): BanditBundle {
  if (raw === null || typeof raw !== "object") {
    throw new ModelLoadError("Bundle bukan objek.");
  }
  const bundle = raw as Partial<BanditBundle>;

  if (bundle.bundleVersion !== BUNDLE_FORMAT_VERSION) {
    throw new ModelLoadError(
      `Versi bundle ${bundle.bundleVersion} tidak didukung (yang didukung: ${BUNDLE_FORMAT_VERSION}).`,
    );
  }

  const model = parseModelArtifact(bundle.model);

  const snapshot = bundle.snapshot as Partial<PriorSnapshot> | undefined;
  if (
    !snapshot ||
    !isStats({ impressions: snapshot.globalImpressions, accepts: snapshot.globalAccepts }) ||
    snapshot.restaurants === null ||
    typeof snapshot.restaurants !== "object" ||
    !Object.values(snapshot.restaurants).every(isStats)
  ) {
    throw new ModelLoadError("Snapshot statistik di bundle rusak.");
  }

  return {
    bundleVersion: BUNDLE_FORMAT_VERSION,
    model,
    snapshot: snapshot as PriorSnapshot,
    synthetic: bundle.synthetic === true,
  };
}

/**
 * Alasan bundle ini tidak boleh menyajikan, atau `null` kalau boleh.
 *
 * Terpisah dari parsing: bundle sintetis tetap sah untuk dievaluasi, hanya
 * tidak untuk dipakai ke pengguna sungguhan.
 */
export function servingBlocker(
  bundle: BanditBundle,
  options: { allowSynthetic?: boolean } = {},
): string | null {
  if (bundle.synthetic && !options.allowSynthetic) {
    return "bundle dilatih dari data sintetis";
  }
  if (!bundle.synthetic && bundle.model.examples < MIN_SERVING_EXAMPLES) {
    return `baru ${bundle.model.examples} contoh latih (minimum ${MIN_SERVING_EXAMPLES})`;
  }
  return null;
}
