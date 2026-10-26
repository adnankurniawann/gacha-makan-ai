import { describe, expect, it } from "vitest";

import { buildReview, buildSql } from "./ingest-osm.mjs";

const newPlace = {
  osmId: "node/42",
  name: "Warung D'cota",
  category: "Kopi",
  address: "Jl. Raya Jatinangor 12",
  lat: -6.93,
  lng: 107.77,
  priceTier: null,
  rawOpeningHours: "Mo-Fr 08:00-17:00",
  openingHours: [
    {
      day_of_week: 1,
      opens_at: "08:00:00",
      closes_at: "17:00:00",
      crosses_midnight: false,
    },
  ],
};

const matchedPlace = {
  osmId: "node/99",
  id: "11111111-1111-1111-1111-111111111111",
  name: "Ayam Crisbar",
  matchedName: "Ayam Crisbar Jatinangor",
  reason: "nama 0.91 @ 12m",
  category: "Ayam",
  address: null,
  lat: -6.934,
  lng: 107.769,
  priceTier: null,
  rawOpeningHours: null,
  openingHours: null,
};

describe("buildSql", () => {
  it("membungkus semuanya dalam satu transaksi", () => {
    const sql = buildSql("jatinangor", [newPlace], []);
    expect(sql.trimStart().split("\n").find((line) => line === "begin;")).toBe("begin;");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("mengutip apostrof pada nama yang datang dari OSM", () => {
    // Nama ditulis orang asing di internet; kalau ini bocor, seluruh skrip
    // jadi jalur injeksi SQL ke database sendiri.
    const sql = buildSql("jatinangor", [newPlace], []);
    expect(sql).toContain("'Warung D''cota'");
    expect(sql).not.toContain("'Warung D'cota'");
  });

  it("menulis koordinat dalam urutan longitude-latitude", () => {
    const sql = buildSql("jatinangor", [newPlace], []);
    expect(sql).toContain("ST_GeographyFromText('POINT(107.77 -6.93)')");
  });

  it("membiarkan price_tier null alih-alih menebak harga", () => {
    const sql = buildSql("jatinangor", [newPlace], []);
    const valuesLine = sql
      .split("\n")
      .find((line) => line.includes("ST_GeographyFromText"));
    expect(valuesLine).toContain("'Kopi', null,");
  });

  it("tidak menimpa data hasil kurasi manual", () => {
    const sql = buildSql("jatinangor", [], [matchedPlace]);
    expect(sql).toContain("coalesce(r.category, v.category)");
    expect(sql).toContain("coalesce(r.osm_id, v.osm_id)");
  });

  it("menghapus jam buka lama sebagai pernyataan terpisah dari insert", () => {
    const sql = buildSql("jatinangor", [newPlace], []);
    const deleteAt = sql.indexOf("delete from public.opening_hours");
    const insertAt = sql.indexOf("insert into public.opening_hours");

    expect(deleteAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(deleteAt);
    // DELETE harus ditutup titik koma sebelum INSERT dimulai.
    expect(sql.slice(deleteAt, insertAt)).toContain(";");
  });

  it("melewati blok jam buka kalau tidak ada yang berhasil diurai", () => {
    const sql = buildSql("jatinangor", [], [matchedPlace]);
    expect(sql).not.toContain("opening_hours");
  });

  it("menghasilkan SQL yang tetap sah saat tidak ada apa-apa untuk ditulis", () => {
    const sql = buildSql("jatinangor", [], []);
    expect(sql).toContain("begin;");
    expect(sql).toContain("commit;");
    expect(sql).not.toContain("insert into");
  });
});

describe("buildReview", () => {
  const stats = {
    fetched: 120,
    usable: 118,
    internalDuplicates: 3,
    hoursParsed: 40,
    hoursUnparsed: 7,
    missingCategory: 22,
  };

  it("menampilkan keputusan deduplikasi supaya bisa dibantah manusia", () => {
    const review = buildReview("jatinangor", stats, [newPlace], [matchedPlace], []);
    expect(review).toContain("Ayam Crisbar Jatinangor");
    expect(review).toContain("nama 0.91 @ 12m");
  });

  it("mendaftar jam buka yang gagal diurai beserta tulisan aslinya", () => {
    const unparsed = {
      ...newPlace,
      openingHours: null,
      rawOpeningHours: "kadang-kadang",
    };
    const review = buildReview("jatinangor", stats, [unparsed], [], []);
    expect(review).toContain("`kadang-kadang`");
  });

  it("mencatat yang dibuang beserta alasannya", () => {
    const review = buildReview("jatinangor", stats, [], [], [
      { name: "Tanpa Nama", reason: "tanpa nama atau tanpa koordinat" },
    ]);
    expect(review).toContain("tanpa nama atau tanpa koordinat");
  });
});
