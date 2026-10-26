/**
 * Mengubah CSV kurasi manual jadi SQL yang siap ditempel ke Supabase.
 *
 *   node scripts/csv-to-seed.mjs data/kurasi-restoran.csv
 *
 * Dipakai untuk data yang diisi tangan dari Google Maps. Yang boleh disalin
 * dari sana hanya fakta: nama, koordinat, alamat, jam buka. JANGAN menyalin
 * teks ulasan atau foto — menyimpannya secara permanen melanggar ToS Google
 * Maps Platform.
 *
 * Keluarannya SQL untuk direview, bukan tulisan langsung ke database — alasan
 * yang sama seperti ingest OSM: kesalahan pada baris data jauh lebih mudah
 * dicegat sebelum masuk daripada dibersihkan sesudahnya.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseOpeningHours } from "./lib/osm.mjs";
import { sqlNumber, sqlString } from "./lib/postgis.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Kotak pembatas Jatinangor, longgar.
 *
 * Bukan validasi keamanan — ini penangkap salah ketik. Latitude dan longitude
 * yang tertukar adalah kesalahan paling umum saat menyalin dari peta, dan
 * hasilnya titik di tengah Samudra Hindia yang tidak akan pernah muncul di
 * radius siapa pun tanpa ada yang sadar kenapa.
 */
const BOUNDS = { south: -7.0, north: -6.85, west: 107.7, east: 107.85 };

/** Pembaca CSV kecil yang menghormati tanda kutip ganda. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
}

const REQUIRED = ["nama", "kategori", "harga", "lat", "lng"];

function main() {
  const input = process.argv[2] ?? "data/kurasi-restoran.csv";
  const text = readFileSync(resolve(ROOT, input), "utf8");

  const [header, ...body] = parseCsv(text);
  if (!header) {
    console.error("CSV kosong.");
    process.exit(1);
  }

  const columns = header.map((name) => name.trim().toLowerCase());
  for (const required of REQUIRED) {
    if (!columns.includes(required)) {
      console.error(`Kolom "${required}" tidak ada. Wajib: ${REQUIRED.join(", ")}`);
      process.exit(1);
    }
  }

  const at = (row, name) => (row[columns.indexOf(name)] ?? "").trim();

  const accepted = [];
  const rejected = [];

  body.forEach((row, index) => {
    const line = index + 2; // +1 header, +1 karena manusia menghitung dari 1
    const nama = at(row, "nama");
    const lat = Number(at(row, "lat"));
    const lng = Number(at(row, "lng"));
    const harga = Number(at(row, "harga"));

    if (nama === "") return rejected.push({ line, nama, alasan: "nama kosong" });
    if (nama.toLowerCase().startsWith("contoh ")) {
      return rejected.push({ line, nama, alasan: "baris contoh, belum diganti" });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return rejected.push({ line, nama, alasan: "koordinat bukan angka" });
    }
    if (lat < BOUNDS.south || lat > BOUNDS.north || lng < BOUNDS.west || lng > BOUNDS.east) {
      return rejected.push({
        line,
        nama,
        alasan: `koordinat di luar Jatinangor (${lat}, ${lng}) — lat dan lng tertukar?`,
      });
    }
    if (!Number.isFinite(harga) || harga <= 0) {
      return rejected.push({ line, nama, alasan: "harga kosong atau nol" });
    }

    const jam = at(row, "jam_buka");
    const openingHours = jam === "" ? null : parseOpeningHours(jam);
    if (jam !== "" && openingHours === null) {
      // Bukan alasan membuang barisnya — tempatnya tetap berguna tanpa jam
      // buka. Tapi harus terlihat, bukan hilang diam-diam.
      rejected.push({ line, nama, alasan: `jam buka "${jam}" tidak terbaca (baris tetap masuk, tanpa jam)` });
    }

    accepted.push({
      nama,
      kategori: at(row, "kategori") || null,
      harga,
      lat,
      lng,
      alamat: at(row, "alamat") || null,
      openingHours,
    });
  });

  if (accepted.length === 0) {
    console.error("\nTidak ada baris yang lolos. Perbaiki dulu:");
    for (const item of rejected) {
      console.error(`  baris ${item.line}: ${item.nama || "(tanpa nama)"} — ${item.alasan}`);
    }
    process.exit(1);
  }

  const lines = [
    "-- ============================================================================",
    "-- Kurasi manual restoran",
    `-- Dibuat ${new Date().toISOString()} dari ${input}`,
    "--",
    "-- Aman dijalankan berulang: baris dengan nama dan koordinat yang sama",
    "-- persis tidak akan digandakan.",
    "-- ============================================================================",
    "",
    "begin;",
    "",
    "insert into public.restaurants",
    "  (name, category, price_tier, location, hygiene_score, is_verified_safe,",
    "   address, data_source, last_verified_at)",
    "select v.name, v.category, v.price_tier,",
    "       ST_GeographyFromText('POINT(' || v.lng || ' ' || v.lat || ')'),",
    "       100, false, v.address, 'manual', now()",
    "from (values",
    accepted
      .map(
        (item) =>
          `  (${sqlString(item.nama)}, ${sqlString(item.kategori)}, ${sqlNumber(item.harga)}, ` +
          `${sqlNumber(item.lng)}, ${sqlNumber(item.lat)}, ${sqlString(item.alamat)})`,
      )
      .join(",\n"),
    ") as v(name, category, price_tier, lng, lat, address)",
    "where not exists (",
    "  select 1 from public.restaurants r",
    "   where lower(r.name) = lower(v.name)",
    "     and ST_DWithin(r.location,",
    "                    ST_GeographyFromText('POINT(' || v.lng || ' ' || v.lat || ')'),",
    "                    50)",
    ");",
    "",
  ];

  const withHours = accepted.filter((item) => item.openingHours?.length);
  if (withHours.length > 0) {
    lines.push(
      "-- ---------------------------------------------------------------------------",
      `-- Jam buka untuk ${withHours.length} tempat`,
      "-- ---------------------------------------------------------------------------",
      "insert into public.opening_hours",
      "  (restaurant_id, day_of_week, opens_at, closes_at, crosses_midnight)",
      "select r.id, v.dow, v.opens::time, v.closes::time, v.crosses",
      "  from (values",
      withHours
        .flatMap((item) =>
          item.openingHours.map(
            (hour) =>
              `    (${sqlString(item.nama)}, ${hour.day_of_week}, ` +
              `${sqlString(hour.opens_at)}, ${sqlString(hour.closes_at)}, ${hour.crosses_midnight})`,
          ),
        )
        .join(",\n"),
      "  ) as v(name, dow, opens, closes, crosses)",
      "  join public.restaurants r on lower(r.name) = lower(v.name)",
      "on conflict (restaurant_id, day_of_week, opens_at) do update set",
      "  closes_at        = excluded.closes_at,",
      "  crosses_midnight = excluded.crosses_midnight;",
      "",
    );
  }

  lines.push("commit;", "");

  const outputDir = resolve(ROOT, "supabase/generated");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, "kurasi-manual.sql");
  writeFileSync(outputPath, lines.join("\n"), "utf8");

  console.log(`${accepted.length} tempat siap dimasukkan.`);
  console.log(`${withHours.length} di antaranya punya jam buka.`);

  if (rejected.length > 0) {
    console.log("\nPerlu diperiksa:");
    for (const item of rejected) {
      console.log(`  baris ${item.line}: ${item.nama || "(tanpa nama)"} — ${item.alasan}`);
    }
  }

  console.log(`\nJalankan: ${outputPath}`);
}

main();
