/**
 * Membekukan nama + tag `cuisine` tempat makan se-Indonesia dari OpenStreetMap
 * sebagai bahan test set evaluasi kategorisasi.
 *
 *   npx tsx scripts/snapshot-osm-cuisine.ts
 *
 * Hasilnya ml/eval/osm-cuisine.json, dan berkas itu di-commit. Evaluasi
 * membaca berkas ini, bukan Overpass: data OSM berubah tiap hari, dan angka
 * evaluasi yang tidak bisa diulang persis tidak bisa dibandingkan antar-run.
 *
 * Data © kontributor OpenStreetMap, lisensi ODbL 1.0 — lihat
 * ml/eval/ATTRIBUTION.md.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { OsmPlace, OsmSnapshot } from "@/lib/ml/eval/dataset";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "ml/eval/osm-cuisine.json");

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const AMENITIES = ["restaurant", "fast_food", "cafe", "food_court", "ice_cream"];

// Sama dengan ingest-osm.mjs. Overpass menolak permintaan tanpa User-Agent.
const USER_AGENT = "gacha-makan-ingest/1.0 (proyek kuliah, kontak via GitHub)";

const QUERY = `
[out:json][timeout:300];
area["ISO3166-1"="ID"][admin_level=2]->.indonesia;
nwr["amenity"~"^(${AMENITIES.join("|")})$"]["name"]["cuisine"](area.indonesia);
out tags;
`.trim();

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
}

async function fetchOverpass(): Promise<{ elements: OverpassElement[]; osmBase: string }> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({ data: QUERY }),
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        elements?: OverpassElement[];
        osm3s?: { timestamp_osm_base?: string };
      };
      return { elements: payload.elements ?? [], osmBase: payload.osm3s?.timestamp_osm_base ?? "" };
    }

    // 429 dan 504 adalah cara Overpass bilang "lagi sibuk", bukan "salah".
    if (![429, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error(
        `Overpass menjawab HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`,
      );
    }
    const waitSeconds = attempt * 30;
    console.log(`  Overpass sibuk (HTTP ${response.status}), tunggu ${waitSeconds}s…`);
    await new Promise((done) => setTimeout(done, waitSeconds * 1000));
  }
  throw new Error("Overpass tidak bisa dihubungi setelah 3 percobaan.");
}

async function main(): Promise<void> {
  console.log("Mengambil tempat makan bernama dengan tag cuisine se-Indonesia…");
  const { elements, osmBase } = await fetchOverpass();

  // Hanya yang dibutuhkan evaluasi. Tag lain (alamat, telepon, jam) tidak
  // ikut disimpan.
  const places: OsmPlace[] = elements
    .filter((element) => element.tags?.name && element.tags?.cuisine)
    .map((element) => ({
      osm: `${element.type[0]}${element.id}`,
      name: element.tags!.name,
      cuisine: element.tags!.cuisine,
      amenity: element.tags!.amenity ?? "",
    }))
    .sort((a, b) => a.osm.localeCompare(b.osm));

  const header: Omit<OsmSnapshot, "places"> = {
    source: "OpenStreetMap via Overpass API",
    license: "ODbL-1.0, © OpenStreetMap contributors",
    osmBase,
    query: QUERY,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  // Satu tempat per baris, supaya snapshot berikutnya bisa dibaca sebagai diff.
  const body = places.map((place) => `    ${JSON.stringify(place)}`).join(",\n");
  writeFileSync(
    OUTPUT,
    `${JSON.stringify(header, null, 2).replace(/\n}$/, "")},\n  "places": [\n${body}\n  ]\n}\n`,
  );
  console.log(`${places.length} tempat disimpan ke ${OUTPUT} (data OSM per ${osmBase}).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
