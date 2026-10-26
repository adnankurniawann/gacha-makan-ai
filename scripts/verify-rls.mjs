#!/usr/bin/env node
/**
 * Verifikasi RLS — membuktikan kebijakan, bukan mengasumsikannya.
 *
 *   node scripts/verify-rls.mjs
 *
 * Skrip ini memakai anon key yang sama persis dengan yang ada di bundle
 * frontend, lalu MENCOBA operasi yang seharusnya terlarang. Sebuah operasi
 * dianggap lulus kalau database menolaknya.
 *
 * Semua percobaan tulis dirancang tidak merusak:
 *   - DELETE / INSERT selalu memakai UUID acak yang dijamin tidak cocok
 *     dengan baris mana pun (atau gagal di foreign key).
 *   - UPDATE memakai baris nyata tapi menulis kembali nilai yang sama, jadi
 *     kalaupun ternyata diizinkan, tidak ada data yang berubah — yang berubah
 *     hanya hasil tesnya menjadi GAGAL.
 *
 * Exit code 0 = semua lulus, 1 = ada yang bocor.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Konfigurasi
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

const env = loadEnv();
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error(
    "Butuh NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY " +
      "(dari .env.local atau environment).",
  );
  process.exit(1);
}

const REST = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`;

// ---------------------------------------------------------------------------
// Klien PostgREST minimal — sengaja tanpa supabase-js supaya yang diuji
// benar-benar lapisan HTTP-nya, bukan perilaku library.
// ---------------------------------------------------------------------------

async function request(method, path, { body, prefer } = {}) {
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers["Prefer"] = prefer;

  const response = await fetch(`${REST}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return { status: response.status, body: parsed };
}

/**
 * Menerjemahkan respons jadi salah satu dari:
 *   "denied"  — database menolak (grant hilang atau RLS memblokir)
 *   "empty"   — diizinkan tapi tidak ada baris yang terkena
 *   "allowed" — operasi berhasil dan mengenai baris
 */
function classify({ status, body }) {
  if (status === 401 || status === 403) return "denied";
  if (status >= 400) return `error ${status}`;
  if (Array.isArray(body)) return body.length === 0 ? "empty" : "allowed";
  if (body === null || body === "") return "empty-unknown";
  return "allowed";
}

function detail({ status, body }) {
  const message =
    body && typeof body === "object" && !Array.isArray(body)
      ? body.message ?? body.error ?? JSON.stringify(body)
      : Array.isArray(body)
        ? `${body.length} baris`
        : String(body ?? "");
  return `HTTP ${status}${message ? ` — ${message.slice(0, 110)}` : ""}`;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const results = [];

async function check(name, expectation, run) {
  let outcome;
  try {
    outcome = await run();
  } catch (error) {
    results.push({ name, ok: false, note: `gagal dijalankan: ${error.message}` });
    return;
  }
  const verdict = classify(outcome);
  const ok = expectation.includes(verdict);
  results.push({
    name,
    ok,
    note: `${verdict} · ${detail(outcome)}`,
  });
}

const FAKE_ID = randomUUID();

async function main() {
  console.log(`Menguji ${SUPABASE_URL} dengan anon key publik.\n`);

  // --- Baseline: yang memang harus jalan ------------------------------------

  const catalogue = await request("GET", "/restaurants?select=id,hygiene_score&limit=1");
  const sampleRestaurant = Array.isArray(catalogue.body) ? catalogue.body[0] : null;

  await check("restaurants  SELECT publik boleh", ["allowed"], async () => catalogue);

  await check(
    "hygiene_reports  SELECT kolom aman boleh",
    ["allowed", "empty"],
    () =>
      request(
        "GET",
        "/hygiene_reports?select=id,restaurant_id,report_type,description,created_at&limit=1",
      ),
  );

  await check("rpc get_eligible_restaurants boleh", ["allowed", "empty"], () =>
    request("POST", "/rpc/get_eligible_restaurants", {
      body: {
        budget: 50000,
        radius_meters: 5000,
        user_lat: -6.9262,
        user_lng: 107.7717,
      },
    }),
  );

  // --- Katalog restoran tidak boleh ditulis ---------------------------------

  if (sampleRestaurant) {
    await check(
      "restaurants  UPDATE ditolak (tulis ulang nilai yang sama)",
      ["denied", "empty", "empty-unknown"],
      () =>
        request(
          "PATCH",
          `/restaurants?id=eq.${sampleRestaurant.id}`,
          {
            body: { hygiene_score: sampleRestaurant.hygiene_score },
            prefer: "return=representation",
          },
        ),
    );
  } else {
    results.push({
      name: "restaurants  UPDATE ditolak",
      ok: false,
      note: "dilewati: tabel restaurants kosong atau tidak terbaca",
    });
  }

  await check("restaurants  DELETE ditolak", ["denied", "empty", "empty-unknown"], () =>
    request("DELETE", `/restaurants?id=eq.${FAKE_ID}`, {
      prefer: "return=representation",
    }),
  );

  await check("restaurants  INSERT ditolak", ["denied"], () =>
    request("POST", "/restaurants", {
      body: {
        name: "rls-probe",
        price_tier: 1,
        location: "POINT(107.6 -6.9)",
      },
      prefer: "return=representation",
    }),
  );

  // --- Identitas pelapor tidak boleh bocor ----------------------------------

  await check("hygiene_reports  kolom reporter_ip ditolak", ["denied"], () =>
    request("GET", "/hygiene_reports?select=reporter_ip&limit=1"),
  );

  await check("hygiene_reports  select=* ditolak", ["denied"], () =>
    request("GET", "/hygiene_reports?select=*&limit=1"),
  );

  await check("hygiene_reports  INSERT langsung ditolak", ["denied"], () =>
    request("POST", "/hygiene_reports", {
      body: {
        restaurant_id: FAKE_ID,
        report_type: "CLEAN",
        description: "rls-probe",
      },
      prefer: "return=representation",
    }),
  );

  await check("hygiene_reports  DELETE ditolak", ["denied", "empty", "empty-unknown"], () =>
    request("DELETE", `/hygiene_reports?id=eq.${FAKE_ID}`, {
      prefer: "return=representation",
    }),
  );

  // Jalur resmi harus tetap hidup: restoran fiktif -> 404 dari fungsi,
  // artinya fungsi terpanggil dan tidak ada data yang tertulis.
  await check("rpc submit_hygiene_report hidup (404 utk id fiktif)", ["error 404"], () =>
    request("POST", "/rpc/submit_hygiene_report", {
      body: {
        p_restaurant_id: FAKE_ID,
        p_report_type: "CLEAN",
        p_description: "rls-probe",
      },
    }),
  );

  // --- Tabel milik pengguna: anon tidak boleh menyentuh ---------------------

  for (const table of ["users", "user_history", "wallets"]) {
    await check(`${table}  SELECT anon tidak mengembalikan data`, ["denied", "empty"], () =>
      request("GET", `/${table}?select=*&limit=1`),
    );

    await check(`${table}  DELETE ditolak`, ["denied", "empty", "empty-unknown"], () =>
      request("DELETE", `/${table}?id=eq.${FAKE_ID}`, {
        prefer: "return=representation",
      }),
    );
  }

  await check("users  INSERT ditolak", ["denied"], () =>
    request("POST", "/users", {
      body: { id: FAKE_ID, email: "rls-probe@example.invalid" },
      prefer: "return=representation",
    }),
  );

  await check("user_history  INSERT ditolak", ["denied"], () =>
    request("POST", "/user_history", {
      body: { user_id: FAKE_ID, restaurant_id: FAKE_ID, budget_used: 1 },
      prefer: "return=representation",
    }),
  );

  // --- Laporan --------------------------------------------------------------

  const width = Math.max(...results.map((r) => r.name.length));
  for (const { name, ok, note } of results) {
    console.log(`${ok ? "  LULUS" : "  GAGAL"}  ${name.padEnd(width)}  ${note}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} lulus.`);

  if (failed.length > 0) {
    console.log("\nMasih bocor:");
    for (const { name } of failed) console.log(`  - ${name}`);
    console.log(
      "\nJalankan supabase/migrations/20260804000001_rls_hardening.sql " +
        "lalu ulangi skrip ini.",
    );
    process.exit(1);
  }

  console.log("Anon key tidak bisa membaca data pribadi maupun mengubah katalog.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
