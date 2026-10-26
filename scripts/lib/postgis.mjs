/**
 * Pembaca koordinat PostGIS untuk skrip Node.
 *
 * Aplikasi punya parser yang lebih lengkap di src/lib/supabase/queries.ts
 * (GeoJSON, WKT, dan EWKB). Di sini cukup EWKB hex, karena itulah satu-satunya
 * bentuk yang dikembalikan PostgREST untuk kolom geography.
 */

/**
 * @param {string} hex - EWKB hex seperti yang dikembalikan PostgREST
 * @returns {{lat: number, lng: number}}
 */
export function parseEwkbHexPoint(hex) {
  if (typeof hex !== "string") {
    throw new TypeError(`parseEwkbHexPoint: butuh string, dapat ${typeof hex}`);
  }

  const clean = hex.trim();
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2 !== 0) {
    throw new Error(`parseEwkbHexPoint: bukan EWKB hex yang sah: "${hex}"`);
  }

  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < clean.length; index += 2) {
    bytes[index / 2] = Number.parseInt(clean.slice(index, index + 2), 16);
  }

  const view = new DataView(bytes.buffer);
  if (view.getUint8(0) !== 1) {
    throw new Error("parseEwkbHexPoint: hanya little-endian yang didukung");
  }

  const geometryType = view.getUint32(1, true);
  if ((geometryType & 0xff) !== 1) {
    throw new Error("parseEwkbHexPoint: hanya tipe Point yang didukung");
  }

  // Bit SRID menentukan apakah ada 4 byte tambahan sebelum koordinat.
  const hasSrid = (geometryType & 0x20000000) !== 0;
  const offset = hasSrid ? 9 : 5;

  const lng = view.getFloat64(offset, true);
  const lat = view.getFloat64(offset + 8, true);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`parseEwkbHexPoint: koordinat tidak sah di "${hex}"`);
  }

  return { lat, lng };
}

/**
 * Mengutip nilai untuk disisipkan ke SQL yang dibuat skrip.
 *
 * Data ini datang dari OpenStreetMap, artinya ditulis orang asing dan harus
 * diperlakukan sebagai masukan tidak tepercaya. Semua nilai teks lewat sini.
 */
export function sqlString(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Angka untuk SQL, atau `null` kalau bukan angka yang terhingga. */
export function sqlNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "null";
}
