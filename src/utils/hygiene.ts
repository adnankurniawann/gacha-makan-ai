/**
 * Hygiene score display shared by every page that shows one.
 *
 * `null` means nobody has reported the place yet — not "clean". Showing 100
 * for it made almost the whole OSM catalogue look verified.
 */

export const UNRATED_HYGIENE_LABEL = "Belum ada laporan";

/** "85", or the unrated label when there is no score yet. */
export function formatHygieneScore(score: number | null | undefined): string {
  return typeof score === "number" ? String(score) : UNRATED_HYGIENE_LABEL;
}
