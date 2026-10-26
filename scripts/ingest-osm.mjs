// Tanpa shebang dengan sengaja: berkas ini diimpor oleh ingest-osm.test.mjs,
// dan transform Vitest memindahkan import ke atas sehingga shebang-nya
// terdorong ke tengah baris dan gagal di-parse. Skripnya toh selalu dijalankan
// sebagai `node scripts/ingest-osm.mjs`.
/**
 * Ingest restoran dari OpenStreetMap lewat Overpass API.
 *
 *   node scripts/ingest-osm.mjs                    # area default: jatinangor
 *   node scripts/ingest-osm.mjs --area=ganesha
 *   node scripts/ingest-osm.mjs --area=jatinangor --limit=50
 *
 * Skrip ini TIDAK menulis ke database. Ia menghasilkan dua berkas di
 * supabase/generated/:
 *
 *   <area>.sql        — SQL untuk ditempel ke Supabase SQL Editor
 *   <area>.review.md  — keputusan deduplikasi, untuk dibaca manusia dulu
 *
 * Dua alasan:
 *   1. Sejak Fase A, anon key tidak punya hak tulis ke restaurants sama sekali,
 *      dan proyek ini sengaja tidak memakai service_role key.
 *   2. Deduplikasi berbasis kemiripan nama tidak pernah 100% benar. Menggabung
 *      dua warung berbeda jadi satu baris jauh lebih sulit dibereskan daripada
 *      membaca daftar dulu sebelum menjalankan SQL-nya.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findDuplicate, toCandidate } from "./lib/osm.mjs";
import { parseEwkbHexPoint, sqlNumber, sqlString } from "./lib/postgis.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = resolve(ROOT, "supabase/generated");

// ---------------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------------

/**
 * Bounding box per area, urutan Overpass: (selatan, barat, utara, timur).
 *
 * Catatan: data seed proyek ini seluruhnya Jatinangor, bukan sekitar ITB
 * Ganesha seperti asumsi di spec. `jatinangor` karena itu jadi default.
 * Preset `ganesha` disediakan kalau target areanya nanti diputuskan pindah.
 */
const AREAS = {
  jatinangor: {
    label: "Jatinangor dan sekitarnya",
    bbox: [-6.955, 107.745, -6.9, 107.8],
  },
  ganesha: {
    label: "ITB Ganesha, Dago, Cisitu, Tubagus Ismail, Sangkuriang",
    bbox: [-6.905, 107.595, -6.86, 107.63],
  },
};

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

const AMENITIES = ["restaurant", "fast_food", "cafe", "food_court", "ice_cream"];

// ---------------------------------------------------------------------------
// Argumen
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { area: "jatinangor", limit: Infinity };

  for (const entry of argv.slice(2)) {
    const match = entry.match(/^--([a-z]+)=(.*)$/);
    if (!match) {
      throw new Error(`Argumen tidak dikenali: ${entry}`);
    }
    const [, key, value] = match;

    if (key === "area") {
      if (!AREAS[value]) {
        throw new Error(
          `Area "${value}" tidak dikenal. Pilihan: ${Object.keys(AREAS).join(", ")}`,
        );
      }
      args.area = value;
    } else if (key === "limit") {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`--limit harus bilangan bulat positif, dapat "${value}"`);
      }
      args.limit = limit;
    } else {
      throw new Error(`Argumen tidak dikenali: --${key}`);
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Sumber data
// ---------------------------------------------------------------------------

function loadEnv() {
  const env = {};
  for (const file of [".env.local", ".env"]) {
    let raw;
    try {
      raw = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (match) env[match[1]] ??= match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

/**
 * Ambil elemen dari Overpass. Ini layanan gratis yang dipakai bersama-sama,
 * jadi permintaannya satu kali dengan timeout longgar, bukan dipecah-pecah,
 * dan kegagalan sementara dicoba ulang dengan jeda yang melebar.
 */
async function fetchOverpass(bbox) {
  const [south, west, north, east] = bbox;
  const filter = `^(${AMENITIES.join("|")})$`;

  const query = `
[out:json][timeout:90];
nwr["amenity"~"${filter}"](${south},${west},${north},${east});
out center tags;
`.trim();

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "gacha-makan-ingest/1.0 (proyek kuliah, kontak via GitHub)",
      },
      body: new URLSearchParams({ data: query }),
    });

    if (response.ok) {
      const payload = await response.json();
      return payload.elements ?? [];
    }

    // 429 dan 504 adalah cara Overpass bilang "lagi sibuk", bukan "salah".
    if (![429, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error(
        `Overpass menjawab HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`,
      );
    }

    const waitSeconds = attempt * 15;
    console.log(`  Overpass sibuk (HTTP ${response.status}), tunggu ${waitSeconds}s…`);
    await new Promise((done) => setTimeout(done, waitSeconds * 1000));
  }

  throw new Error("Overpass tidak bisa dihubungi setelah 3 percobaan.");
}

/**
 * Baris restoran yang sudah ada, dibaca dengan anon key. Membaca memang
 * diizinkan RLS; menulis tidak, dan itu memang disengaja.
 */
async function fetchExisting(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Butuh NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local.",
    );
  }

  const response = await fetch(
    `${url.replace(/\/+$/, "")}/rest/v1/restaurants?select=id,name,location,osm_id,category,address,price_tier`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );

  if (!response.ok) {
    throw new Error(
      `Gagal membaca restaurants: HTTP ${response.status} — ${(await response.text()).slice(0, 200)}`,
    );
  }

  const rows = await response.json();

  return rows.map((row) => {
    const { lat, lng } = parseEwkbHexPoint(row.location);
    return { ...row, lat, lng };
  });
}

// ---------------------------------------------------------------------------
// Penyusunan SQL
// ---------------------------------------------------------------------------

function openingHoursValues(osmId, rows) {
  return rows
    .map(
      (row) =>
        `    (${sqlString(osmId)}, ${row.day_of_week}, ${sqlString(row.opens_at)}::time, ` +
        `${sqlString(row.closes_at)}::time, ${row.crosses_midnight})`,
    )
    .join(",\n");
}

export function buildSql(area, inserts, enrichments) {
  const lines = [];

  lines.push(
    "-- ============================================================================",
    `-- Ingest OpenStreetMap — ${AREAS[area].label}`,
    `-- Dibuat ${new Date().toISOString()} oleh scripts/ingest-osm.mjs`,
    "--",
    "-- Baca <area>.review.md dulu. Keputusan deduplikasi di sana yang menentukan",
    "-- baris mana yang dianggap baru dan mana yang dianggap sudah ada.",
    "--",
    "-- Aman dijalankan berulang: pencocokan memakai osm_id.",
    "-- ============================================================================",
    "",
    "begin;",
    "",
  );

  if (inserts.length > 0) {
    lines.push(
      "-- ---------------------------------------------------------------------------",
      `-- ${inserts.length} tempat baru`,
      "--",
      "-- price_tier sengaja null: OpenStreetMap praktis tidak pernah punya harga,",
      "-- dan menebaknya berarti membohongi filter budget. Selama null, baris ini",
      "-- TIDAK akan muncul di hasil spin — ia menunggu di restaurant_curation_queue",
      "-- sampai ada yang mengisi harganya.",
      "-- ---------------------------------------------------------------------------",
      "insert into public.restaurants",
      "  (name, category, price_tier, location, hygiene_score, is_verified_safe,",
      "   address, osm_id, data_source, last_verified_at)",
      "values",
    );

    lines.push(
      inserts
        .map(
          (item) =>
            `  (${sqlString(item.name)}, ${sqlString(item.category)}, ${sqlNumber(item.priceTier)}, ` +
            `ST_GeographyFromText('POINT(${item.lng} ${item.lat})'), 100, false, ` +
            `${sqlString(item.address)}, ${sqlString(item.osmId)}, 'osm', now())`,
        )
        .join(",\n"),
    );

    lines.push(
      "on conflict (osm_id) where osm_id is not null do update set",
      "  name             = excluded.name,",
      "  category         = coalesce(restaurants.category, excluded.category),",
      "  address          = coalesce(restaurants.address, excluded.address),",
      "  last_verified_at = now();",
      "",
    );
  }

  if (enrichments.length > 0) {
    lines.push(
      "-- ---------------------------------------------------------------------------",
      `-- ${enrichments.length} baris yang sudah ada, dikaitkan ke objek OSM-nya`,
      "--",
      "-- Hanya mengisi kolom yang masih kosong. Data hasil kurasi manual selalu",
      "-- menang atas data OSM — itu keunggulan kita, bukan sesuatu untuk ditimpa.",
      "-- ---------------------------------------------------------------------------",
      "update public.restaurants as r set",
      "  osm_id           = coalesce(r.osm_id, v.osm_id),",
      "  category         = coalesce(r.category, v.category),",
      "  address          = coalesce(r.address, v.address),",
      "  last_verified_at = now()",
      "from (values",
      enrichments
        .map(
          (item) =>
            `  (${sqlString(item.id)}::uuid, ${sqlString(item.osmId)}, ` +
            `${sqlString(item.category)}, ${sqlString(item.address)})`,
        )
        .join(",\n"),
      ") as v(id, osm_id, category, address)",
      "where r.id = v.id;",
      "",
    );
  }

  const withHours = [...inserts, ...enrichments].filter(
    (item) => item.openingHours && item.openingHours.length > 0,
  );

  if (withHours.length > 0) {
    const values = withHours
      .map((item) => openingHoursValues(item.osmId, item.openingHours))
      .join(",\n");

    lines.push(
      "-- ---------------------------------------------------------------------------",
      `-- Jam buka untuk ${withHours.length} tempat`,
      "--",
      "-- Dua pernyataan terpisah, bukan satu CTE: menghapus dan menyisipkan ke",
      "-- tabel yang sama dalam satu statement membuat DELETE tidak terlihat oleh",
      "-- pengecekan ON CONFLICT milik INSERT. Keduanya tetap satu transaksi.",
      "--",
      "-- Baris lama dihapus dulu supaya jadwal yang dicabut di OSM ikut hilang di",
      "-- sini. Tanpa itu, perubahan jam buka hanya bisa menambah, tidak mengurangi.",
      "-- ---------------------------------------------------------------------------",
      "delete from public.opening_hours",
      " where restaurant_id in (",
      "   select id from public.restaurants where osm_id in (",
      withHours.map((item) => `     ${sqlString(item.osmId)}`).join(",\n"),
      "   )",
      " );",
      "",
      "insert into public.opening_hours",
      "  (restaurant_id, day_of_week, opens_at, closes_at, crosses_midnight)",
      "select r.id, v.day_of_week, v.opens_at, v.closes_at, v.crosses_midnight",
      "  from (values",
      values,
      "  ) as v(osm_id, day_of_week, opens_at, closes_at, crosses_midnight)",
      "  join public.restaurants r on r.osm_id = v.osm_id;",
      "",
    );
  }

  lines.push("commit;", "");
  return lines.join("\n");
}

export function buildReview(area, stats, inserts, enrichments, skipped) {
  const lines = [
    `# Review ingest OSM — ${AREAS[area].label}`,
    "",
    `Dibuat ${new Date().toISOString()}.`,
    "",
    "## Ringkasan",
    "",
    "| Angka | Jumlah |",
    "|---|---|",
    `| Elemen dari Overpass | ${stats.fetched} |`,
    `| Layak dipakai (punya nama dan koordinat) | ${stats.usable} |`,
    `| Duplikat di dalam hasil Overpass sendiri | ${stats.internalDuplicates} |`,
    `| **Tempat baru** | **${inserts.length}** |`,
    `| Cocok dengan baris yang sudah ada | ${enrichments.length} |`,
    `| Jam buka berhasil diurai | ${stats.hoursParsed} |`,
    `| Jam buka ada tapi gagal diurai | ${stats.hoursUnparsed} |`,
    `| Tanpa kategori | ${stats.missingCategory} |`,
    "",
    "## Yang perlu diperiksa manusia",
    "",
    "Deduplikasi memakai kemiripan nama dan jarak, jadi ia bisa salah dua arah:",
    "menggabungkan dua warung berbeda, atau melewatkan tempat yang sama karena",
    "namanya ditulis jauh berbeda. Baca daftar di bawah sebelum menjalankan SQL-nya.",
    "",
  ];

  if (enrichments.length > 0) {
    lines.push(
      "### Dianggap sama dengan baris yang sudah ada",
      "",
      "| Nama di OSM | Dicocokkan dengan | Alasan |",
      "|---|---|---|",
      ...enrichments.map(
        (item) => `| ${item.name} | ${item.matchedName} | ${item.reason} |`,
      ),
      "",
    );
  }

  if (skipped.length > 0) {
    lines.push(
      "### Dibuang sebelum sampai ke SQL",
      "",
      "| Nama | Alasan |",
      "|---|---|",
      ...skipped.map((item) => `| ${item.name} | ${item.reason} |`),
      "",
    );
  }

  const unparsed = [...inserts, ...enrichments].filter(
    (item) => item.rawOpeningHours && !item.openingHours,
  );

  if (unparsed.length > 0) {
    lines.push(
      "### Jam buka yang tidak bisa diurai",
      "",
      "Sengaja tidak dimasukkan setengah-setengah. Isi manual di Supabase Studio,",
      "atau tambahkan pola barunya ke `parseOpeningHours` di `scripts/lib/osm.mjs`.",
      "",
      "| Nama | Tulisan aslinya di OSM |",
      "|---|---|",
      ...unparsed.map(
        (item) => `| ${item.name} | \`${item.rawOpeningHours}\` |`,
      ),
      "",
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Alur utama
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const area = AREAS[args.area];

  console.log(`Area: ${area.label}`);
  console.log(`Bounding box: ${area.bbox.join(", ")}\n`);

  console.log("Membaca data yang sudah ada di Supabase…");
  const env = loadEnv();
  const existing = await fetchExisting(env);
  console.log(`  ${existing.length} restoran sudah terdata.\n`);

  console.log("Meminta data ke Overpass API…");
  const elements = await fetchOverpass(area.bbox);
  console.log(`  ${elements.length} elemen diterima.\n`);

  const stats = {
    fetched: elements.length,
    usable: 0,
    internalDuplicates: 0,
    hoursParsed: 0,
    hoursUnparsed: 0,
    missingCategory: 0,
  };

  const inserts = [];
  const enrichments = [];
  const skipped = [];

  // Daftar pembanding tumbuh sambil jalan, supaya duplikat di dalam hasil
  // Overpass sendiri (node dan way untuk bangunan yang sama) ikut tersaring.
  const known = [...existing];

  for (const element of elements) {
    const candidate = toCandidate(element);

    if (candidate === null) {
      skipped.push({
        name: element?.tags?.name ?? `${element?.type}/${element?.id}`,
        reason: "tanpa nama atau tanpa koordinat",
      });
      continue;
    }

    stats.usable += 1;
    if (candidate.openingHours) stats.hoursParsed += 1;
    else if (candidate.rawOpeningHours) stats.hoursUnparsed += 1;
    if (candidate.category === null) stats.missingCategory += 1;

    const duplicate = findDuplicate(candidate, known);

    if (duplicate === null) {
      if (inserts.length >= args.limit) {
        skipped.push({ name: candidate.name, reason: "melebihi --limit" });
        continue;
      }
      inserts.push(candidate);
      known.push({ ...candidate, osm_id: candidate.osmId });
      continue;
    }

    // Padanan tanpa `id` berarti ia berasal dari hasil Overpass yang sama,
    // bukan dari database — itu duplikat internal, cukup dibuang.
    if (!duplicate.match.id) {
      stats.internalDuplicates += 1;
      skipped.push({
        name: candidate.name,
        reason: `duplikat internal Overpass (${duplicate.reason})`,
      });
      continue;
    }

    enrichments.push({
      ...candidate,
      id: duplicate.match.id,
      matchedName: duplicate.match.name,
      reason: duplicate.reason,
    });
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const sqlPath = resolve(OUTPUT_DIR, `${args.area}.sql`);
  const reviewPath = resolve(OUTPUT_DIR, `${args.area}.review.md`);

  writeFileSync(sqlPath, buildSql(args.area, inserts, enrichments), "utf8");
  writeFileSync(
    reviewPath,
    buildReview(args.area, stats, inserts, enrichments, skipped),
    "utf8",
  );

  console.log("Hasil:");
  console.log(`  ${inserts.length} tempat baru`);
  console.log(`  ${enrichments.length} cocok dengan baris yang sudah ada`);
  console.log(`  ${stats.internalDuplicates} duplikat internal dibuang`);
  console.log(
    `  ${stats.hoursParsed} jam buka terurai, ${stats.hoursUnparsed} gagal diurai`,
  );
  console.log(`  ${stats.missingCategory} tanpa kategori\n`);

  console.log(`Review dulu : ${reviewPath}`);
  console.log(`Lalu jalankan: ${sqlPath}\n`);
  console.log(
    "Ingat: price_tier baris baru masih null, jadi belum muncul di spin.\n" +
      "Isi lewat restaurant_curation_queue sebelum berharap katalognya bertambah.",
  );
}

// Hanya jalan kalau dipanggil langsung dari terminal. Tanpa penjaga ini,
// mengimpor modulnya di test akan ikut menembak Overpass.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`\nGagal: ${error.message}`);
    process.exit(1);
  });
}
