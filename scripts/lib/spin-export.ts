/**
 * Membaca ekspor log spin dan katalog dari Supabase Studio.
 *
 * Skrip ML membaca berkas, bukan database, karena dua alasan. RLS membuat
 * anon key hanya bisa melihat baris milik sendiri — dan skrip ini tidak boleh
 * memakai service_role. Selain itu, pelatihan dari berkas yang disimpan bisa
 * diulang persis; pelatihan dari database yang terus berubah tidak.
 *
 * Diterima `.json` (array objek) atau `.csv` dengan baris judul. Array
 * Postgres di CSV (`{a,b}`) dan array JSON (`["a","b"]`) sama-sama dikenali.
 */

import { readFileSync } from "node:fs";

import type { CatalogEntry } from "@/lib/ml/evaluation";
import type { RawSpinRow } from "@/lib/ml/training";

/** Kueri untuk SQL Editor; hasilnya diunduh sebagai CSV. */
/**
 * Kueri untuk SQL Editor; hasilnya diunduh sebagai CSV.
 *
 * Kolom diambil dari `spin_events`, label dari `spin_events_labeled`. View itu
 * dibuat dengan `e.*` sebelum policy_score, is_raining, dan candidate_ids
 * ditambahkan — Postgres membekukan daftar kolom saat view dibuat, jadi
 * kolom-kolom itu tidak ada di sana.
 */
export const SPIN_EXPORT_SQL = `select e.id, e.user_id, e.restaurant_id, e.shown_at,
       r.category, r.price_tier,
       e.distance_km, e.hour_local, e.day_of_week, e.is_raining,
       l.effective_action, e.policy_score, e.policy,
       e.candidate_ids, e.candidate_distances_m
  from public.spin_events e
  join public.spin_events_labeled l on l.id = e.id
  join public.restaurants r on r.id = e.restaurant_id
 order by e.shown_at;`;

export const RESTAURANT_EXPORT_SQL = `select id, category, price_tier from public.restaurants;`;

/** Pembaca CSV kecil yang menghormati tanda kutip ganda. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);

  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((values) =>
    Object.fromEntries(header.map((name, index) => [name.trim(), values[index] ?? ""])),
  );
}

function readRecords(path: string): Record<string, unknown>[] {
  const text = readFileSync(path, "utf8");
  if (path.endsWith(".json")) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error(`${path}: isinya harus array JSON.`);
    return data;
  }
  return parseCsv(text);
}

function nullable(value: unknown): unknown {
  return value === "" || value === undefined ? null : value;
}

function toNumber(value: unknown): number | null {
  const v = nullable(value);
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBoolean(value: unknown): boolean | null {
  const v = nullable(value);
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "t") return true;
  if (v === "false" || v === "f") return false;
  return null;
}

function toArray(value: unknown): string[] | null {
  const v = nullable(value);
  if (v === null) return null;
  if (Array.isArray(v)) return v.map(String);
  const text = String(v).trim();
  if (text.startsWith("[")) return (JSON.parse(text) as unknown[]).map(String);
  if (text.startsWith("{") && text.endsWith("}")) {
    const inner = text.slice(1, -1);
    return inner === "" ? [] : inner.split(",").map((item) => item.replace(/^"|"$/g, ""));
  }
  return null;
}

function required(record: Record<string, unknown>, key: string, line: number): string {
  const value = nullable(record[key]);
  if (value === null) throw new Error(`baris ${line}: kolom "${key}" kosong.`);
  return String(value);
}

export function loadSpinRows(path: string): RawSpinRow[] {
  return readRecords(path).map((record, index) => {
    const line = index + 2;
    const distances = toArray(record.candidate_distances_m);
    return {
      id: required(record, "id", line),
      user_id: required(record, "user_id", line),
      restaurant_id: required(record, "restaurant_id", line),
      shown_at: required(record, "shown_at", line),
      category: (nullable(record.category) as string | null) ?? null,
      price_tier: toNumber(record.price_tier),
      distance_km: toNumber(record.distance_km) ?? 0,
      hour_local: toNumber(record.hour_local) ?? 0,
      day_of_week: toNumber(record.day_of_week) ?? 0,
      is_raining: toBoolean(record.is_raining),
      effective_action: (nullable(record.effective_action) as string | null) ?? null,
      policy_score: toNumber(record.policy_score),
      policy: required(record, "policy", line),
      candidate_ids: toArray(record.candidate_ids),
      candidate_distances_m: distances ? distances.map(Number) : null,
    };
  });
}

export function loadCatalog(path: string): Map<string, CatalogEntry> {
  return new Map(
    readRecords(path).map((record) => [
      String(record.id),
      {
        category: (nullable(record.category) as string | null) ?? null,
        price_tier: toNumber(record.price_tier),
      },
    ]),
  );
}

/** Log sintetis ditandai lewat nama kebijakannya, supaya tidak bisa tertukar. */
export function isSyntheticLog(rows: RawSpinRow[]): boolean {
  return rows.some((row) => row.policy.startsWith("synthetic"));
}

export function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
