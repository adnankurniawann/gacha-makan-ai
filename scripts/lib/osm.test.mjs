import { describe, expect, it } from "vitest";

import {
  categoryFromTags,
  findDuplicate,
  haversineMeters,
  normalizeName,
  parseOpeningHours,
  similarity,
  toCandidate,
} from "./osm.mjs";

describe("normalizeName", () => {
  it("membuang kata jenis usaha dan nama daerah yang tidak membedakan apa pun", () => {
    expect(normalizeName("Warung Nasi Ibu Imas Jatinangor")).toBe("nasi ibu imas");
    expect(normalizeName("RM. Rasana Jatinangor")).toBe("rasana");
    expect(normalizeName("Warkop Agam Medan - Jatinangor")).toBe("agam medan");
  });

  it("menyamakan tanda baca, diakritik, dan huruf besar", () => {
    expect(normalizeName("D'cota Café")).toBe("dcota");
    expect(normalizeName("Ayam-Geprek Pak Budi")).toBe("ayam geprek pak budi");
  });

  it("masih mengenali varian ejaan yang dipisah spasi", () => {
    // Sumber berbeda menulis nama yang sama dengan cara berbeda; dedup
    // mengandalkan similarity, bukan kecocokan persis.
    expect(similarity(normalizeName("D'cota Café"), normalizeName("D Cota Cafe")))
      .toBeGreaterThan(0.6);
  });

  it("tidak mengosongkan nama yang seluruhnya terdiri dari kata umum", () => {
    // Kalau dikosongkan, semua nama semacam ini akan saling cocok.
    expect(normalizeName("Warung Jatinangor")).toBe("warung jatinangor");
    expect(normalizeName("Kantin")).toBe("kantin");
  });

  it("aman untuk masukan yang bukan string atau kosong", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName(null)).toBe("");
    expect(normalizeName("!!!")).toBe("");
  });
});

describe("similarity", () => {
  it("memberi nilai penuh untuk string identik dan nol untuk yang kosong", () => {
    expect(similarity("ayam geprek", "ayam geprek")).toBe(1);
    expect(similarity("", "")).toBe(0);
  });

  it("tahan terhadap perbedaan urutan kata", () => {
    expect(similarity("geprek pak budi", "pak budi geprek")).toBeGreaterThan(0.6);
  });

  it("memisahkan nama yang benar-benar berbeda", () => {
    expect(similarity("bakso mas joko", "dimsum bos")).toBeLessThan(0.3);
  });
});

describe("haversineMeters", () => {
  it("mengembalikan nol untuk titik yang sama", () => {
    expect(haversineMeters(-6.93, 107.77, -6.93, 107.77)).toBe(0);
  });

  it("menghitung jarak pendek dengan galat di bawah satu meter", () => {
    // 0.001 derajat lintang = 111,19 m di permukaan bumi.
    const meters = haversineMeters(-6.93, 107.77, -6.931, 107.77);
    expect(meters).toBeGreaterThan(110);
    expect(meters).toBeLessThan(112);
  });
});

describe("findDuplicate", () => {
  const existing = [
    { id: "a", name: "Ayam Crisbar Jatinangor", lat: -6.9344334, lng: 107.7692999 },
    { id: "b", name: "Dimsum Bos Jatinangor", lat: -6.933277, lng: 107.7739889 },
    { id: "c", name: "Kantin Jatinangor", lat: -6.9331791, lng: 107.7744413, osm_id: "node/111" },
  ];

  it("mencocokkan lewat osm_id tanpa melihat nama atau jarak", () => {
    const hit = findDuplicate(
      { name: "Nama Yang Sudah Berubah", lat: 0, lng: 0, osmId: "node/111" },
      existing,
    );
    expect(hit?.match.id).toBe("c");
    expect(hit?.reason).toBe("osm_id");
  });

  it("mencocokkan nama mirip pada koordinat yang berdekatan", () => {
    const hit = findDuplicate(
      { name: "Ayam Crisbar", lat: -6.93444, lng: 107.76931 },
      existing,
    );
    expect(hit?.match.id).toBe("a");
  });

  it("tidak menggabungkan dua warung berbeda yang bersebelahan", () => {
    // ~120 m dari Dimsum Bos, nama sama sekali lain.
    expect(
      findDuplicate({ name: "Bakso Mas Joko", lat: -6.9343, lng: 107.7739 }, existing),
    ).toBeNull();
  });

  it("tidak menggabungkan nama sama yang berjauhan (cabang berbeda)", () => {
    expect(
      findDuplicate(
        { name: "Ayam Crisbar Jatinangor", lat: -6.95, lng: 107.79 },
        existing,
      ),
    ).toBeNull();
  });

  it("memilih padanan dengan nama paling mirip saat beberapa memenuhi syarat", () => {
    const crowded = [
      { id: "x", name: "Dimsum Bos", lat: -6.9332, lng: 107.77399 },
      { id: "y", name: "Dimsum Bos Jatinangor", lat: -6.93328, lng: 107.77399 },
    ];
    const hit = findDuplicate(
      { name: "Dimsum Bos Jatinangor", lat: -6.933277, lng: 107.7739889 },
      crowded,
    );
    expect(hit?.match.id).toBe("y");
  });

  it("melewati kandidat tanpa nama yang bisa dibandingkan", () => {
    expect(findDuplicate({ name: "!!!", lat: -6.9344, lng: 107.7693 }, existing)).toBeNull();
  });
});

describe("parseOpeningHours", () => {
  it("menangani 24/7", () => {
    const rows = parseOpeningHours("24/7");
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({
      day_of_week: 0,
      opens_at: "00:00:00",
      closes_at: "24:00:00",
      crosses_midnight: false,
    });
  });

  it("memperluas rentang hari", () => {
    const rows = parseOpeningHours("Mo-Fr 08:00-17:00");
    expect(rows.map((row) => row.day_of_week)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.every((row) => row.crosses_midnight === false)).toBe(true);
  });

  it("menandai jadwal yang melewati tengah malam", () => {
    const [row] = parseOpeningHours("Mo 18:00-02:00");
    expect(row).toMatchObject({
      day_of_week: 1,
      opens_at: "18:00:00",
      closes_at: "02:00:00",
      crosses_midnight: true,
    });
  });

  it("menangani rentang hari yang membungkus akhir pekan", () => {
    const rows = parseOpeningHours("Sa-Su 10:00-22:00");
    expect(rows.map((row) => row.day_of_week).sort()).toEqual([0, 6]);
  });

  it("menangani jam pecah dalam satu hari", () => {
    const rows = parseOpeningHours("Mo 08:00-12:00,13:00-17:00");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.opens_at)).toEqual(["08:00:00", "13:00:00"]);
  });

  it("menghormati aturan off yang datang belakangan", () => {
    const rows = parseOpeningHours("Mo-Su 10:00-22:00; Su off");
    expect(rows.some((row) => row.day_of_week === 0)).toBe(false);
    expect(rows).toHaveLength(6);
  });

  it("mengabaikan selector hari libur tanpa menggagalkan sisanya", () => {
    const rows = parseOpeningHours("Mo-Fr 09:00-17:00; PH off");
    expect(rows).toHaveLength(5);
  });

  it("menolak seluruh string begitu ada bagian yang tidak dikenali", () => {
    // Jam buka separuh benar lebih berbahaya daripada yang kosong.
    expect(parseOpeningHours("Mo-Fr 08:00-17:00; sunrise-sunset")).toBeNull();
    expect(parseOpeningHours("Mo 25:00-30:00")).toBeNull();
    expect(parseOpeningHours("kadang buka kadang tidak")).toBeNull();
    expect(parseOpeningHours("")).toBeNull();
    expect(parseOpeningHours(null)).toBeNull();
  });
});

describe("categoryFromTags", () => {
  it("memetakan cuisine yang dikenal", () => {
    expect(categoryFromTags({ cuisine: "chicken" })).toBe("Ayam");
    expect(categoryFromTags({ cuisine: "sundanese" })).toBe("Sunda");
  });

  it("memakai cuisine pertama yang dikenal dari daftar bertitik koma", () => {
    expect(categoryFromTags({ cuisine: "burger;pizza" })).toBe("Barat");
    expect(categoryFromTags({ cuisine: "entahapa;noodle" })).toBe("Mie");
  });

  it("jatuh ke amenity kalau cuisine tidak menolong", () => {
    expect(categoryFromTags({ amenity: "cafe", cuisine: "entahapa" })).toBe("Kopi");
  });

  it("mengembalikan null daripada menebak", () => {
    expect(categoryFromTags({})).toBeNull();
  });
});

describe("toCandidate", () => {
  it("membaca node dengan lat/lon langsung", () => {
    const candidate = toCandidate({
      type: "node",
      id: 42,
      lat: -6.93,
      lon: 107.77,
      tags: {
        name: "Ayam Geprek Pak Budi",
        amenity: "restaurant",
        cuisine: "chicken",
        opening_hours: "Mo-Su 09:00-21:00",
        "addr:street": "Jl. Raya Jatinangor",
        "addr:housenumber": "12",
      },
    });

    expect(candidate).toMatchObject({
      osmId: "node/42",
      name: "Ayam Geprek Pak Budi",
      category: "Ayam",
      address: "Jl. Raya Jatinangor 12",
      priceTier: null,
    });
    expect(candidate.openingHours).toHaveLength(7);
  });

  it("membaca way lewat center", () => {
    const candidate = toCandidate({
      type: "way",
      id: 7,
      center: { lat: -6.93, lon: 107.77 },
      tags: { name: "Kantin Kampus", amenity: "food_court" },
    });

    expect(candidate).toMatchObject({
      osmId: "way/7",
      lat: -6.93,
      lng: 107.77,
      category: "Foodcourt",
    });
  });

  it("membuang elemen tanpa nama atau tanpa koordinat", () => {
    expect(toCandidate({ type: "node", id: 1, lat: -6.9, lon: 107.7, tags: {} })).toBeNull();
    expect(toCandidate({ type: "node", id: 2, tags: { name: "Tanpa Titik" } })).toBeNull();
  });

  it("menyimpan string jam buka mentah saat gagal diurai", () => {
    const candidate = toCandidate({
      type: "node",
      id: 3,
      lat: -6.93,
      lon: 107.77,
      tags: { name: "Warung Misterius", opening_hours: "kadang-kadang" },
    });

    expect(candidate.openingHours).toBeNull();
    expect(candidate.rawOpeningHours).toBe("kadang-kadang");
  });
});
