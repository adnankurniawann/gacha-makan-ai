#!/usr/bin/env node
/**
 * Ukuran JavaScript yang harus diunduh browser untuk memuat sebuah halaman.
 *
 *   npm run build && node scripts/bundle-size.mjs
 *
 * Next 16 dengan Turbopack tidak lagi mencetak tabel "First Load JS", dan nama
 * chunk-nya di-hash sehingga tidak bisa ditebak. Jadi angkanya dibaca dari
 * sumber yang paling tidak bisa berbohong: tag <script> di HTML hasil
 * prerender. Itu persis daftar berkas yang diminta browser saat halaman dibuka.
 *
 * Yang diukur adalah byte, bukan waktu. Waktu interaktif di HP kelas menengah
 * pada 4G goyah juga dipengaruhi latensi dan CPU. Tapi byte adalah bagian yang
 * sepenuhnya di bawah kendali kita, dan pada koneksi lambat ia yang paling
 * menentukan.
 *
 * Hanya route statis yang muncul di sini; route dinamis seperti `/` tidak
 * punya HTML hasil prerender untuk dibaca.
 */

import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = resolve(ROOT, ".next/server/app");
const NEXT_DIR = resolve(ROOT, ".next");

function htmlFiles() {
  try {
    return readdirSync(APP_DIR)
      .filter((file) => file.endsWith(".html") && !file.startsWith("_"))
      .sort();
  } catch {
    console.error("Belum ada hasil build. Jalankan `npm run build` dulu.");
    process.exit(1);
  }
}

/** Semua src <script> yang menunjuk ke /_next/, sesuai urutan munculnya. */
function scriptsIn(html) {
  return [...html.matchAll(/src="(\/_next\/[^"]+)"/g)].map((match) => match[1]);
}

function measure(assetPath) {
  const onDisk = resolve(NEXT_DIR, assetPath.replace(/^\/_next\//, ""));
  try {
    return {
      raw: statSync(onDisk).size,
      gzip: gzipSync(readFileSync(onDisk)).length,
    };
  } catch {
    return { raw: 0, gzip: 0 };
  }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

const rows = htmlFiles().map((file) => {
  const html = readFileSync(resolve(APP_DIR, file), "utf8");
  const assets = [...new Set(scriptsIn(html))];

  let raw = 0;
  let gzip = 0;
  for (const asset of assets) {
    const size = measure(asset);
    raw += size.raw;
    gzip += size.gzip;
  }

  return { route: `/${file.replace(/\.html$/, "")}`, raw, gzip, count: assets.length };
});

rows.sort((a, b) => b.gzip - a.gzip);

const width = Math.max(...rows.map((row) => row.route.length), 8);

console.log(
  `${"Route".padEnd(width)}  ${"Terkirim".padStart(10)}  ${"Mentah".padStart(10)}  Chunk`,
);
console.log("-".repeat(width + 36));

for (const row of rows) {
  console.log(
    `${row.route.padEnd(width)}  ${kb(row.gzip).padStart(10)}  ` +
      `${kb(row.raw).padStart(10)}  ${row.count}`,
  );
}

console.log(
  "\n\"Terkirim\" adalah ukuran setelah gzip — itu yang benar-benar lewat kabel.",
);
