/**
 * Service worker Gacha Makan.
 *
 * Sengaja konservatif. Cache yang agresif di aplikasi yang datanya berubah
 * adalah cara paling cepat membuat bug yang sulit dilacak: orang melihat
 * warung yang sudah tutup, skor kebersihan yang sudah basi, atau saldo yang
 * salah — dan tidak ada tombol "muat ulang" yang menolong karena semuanya
 * datang dari cache.
 *
 * Aturannya:
 *   - /api/*            tidak pernah disentuh. Selalu jaringan.
 *   - navigasi halaman  jaringan dulu, cache cuma jaring pengaman saat offline.
 *   - /_next/static/*   cache dulu. Namanya mengandung hash isi, jadi berkas
 *                       dengan nama sama dijamin isinya sama selamanya.
 *   - selebihnya        lewat begitu saja.
 *
 * NAIKKAN `VERSION` setiap kali berkas ini diubah. Nomor itu yang memicu
 * pembersihan cache lama saat service worker baru aktif.
 */

const VERSION = "v1";
const STATIC_CACHE = `gacha-makan-static-${VERSION}`;
const PAGE_CACHE = `gacha-makan-pages-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      // Halaman offline gagal diambil bukan alasan membatalkan instalasi;
      // aplikasinya tetap berfungsi penuh selama ada jaringan.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== PAGE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Hanya GET yang boleh dilayani dari cache. POST ke /api/spin atau
  // /api/report harus selalu benar-benar terkirim.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Data selalu dari jaringan. Tidak ada pengecualian.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleImmutableAsset(request));
  }
});

/**
 * Jaringan dulu. Cache hanya dipakai kalau jaringannya benar-benar gagal —
 * bukan kalau jaringannya lambat, karena halaman basi yang muncul cepat lebih
 * membingungkan daripada halaman benar yang muncul agak lama.
 */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);

    if (response.ok) {
      const cache = await caches.open(PAGE_CACHE);
      cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response("Lagi offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/**
 * Cache dulu, aman karena nama berkasnya mengandung hash isi: nama yang sama
 * tidak akan pernah menunjuk isi yang berbeda.
 */
async function handleImmutableAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);

  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }

  return response;
}
