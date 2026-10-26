# Implementation Plan: Gacha Makan Backend

## Overview

Implementasi back-end Gacha Makan dilakukan secara incremental dari lapisan terbawah ke atas: utility pure functions → query layer → API route handlers → test setup. Setiap langkah dapat divalidasi secara independen sebelum melanjutkan ke lapisan berikutnya.

Semua route handler menggunakan `Response.json()` (bukan `NextResponse`) sesuai konvensi Next.js 16 App Router. Async Request APIs (`cookies`, `headers`) tidak digunakan di handler ini sehingga tidak ada breaking change yang perlu diantisipasi.

## Tasks

- [x] 1. Setup testing infrastructure
  - Tambahkan `vitest`, `@vitejs/plugin-react`, `jsdom`, `vite-tsconfig-paths`, dan `fast-check` sebagai devDependencies di `package.json`
  - Buat file `vitest.config.mts` di root project dengan konfigurasi `plugins: [tsconfigPaths(), react()]` dan `test.environment: 'jsdom'`
  - Tambahkan script `"test": "vitest --run"` ke `package.json`
  - _Requirements: 7 (Geo Utility), 8 (Gacha Utility) — test infrastructure diperlukan sebelum menulis test apapun_

- [x] 2. Implement `src/utils/geo.ts` — Haversine distance utility
  - [x] 2.1 Implement `haversineDistance` function
    - Ekspor fungsi `haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number`
    - Validasi semua parameter: lat harus dalam [-90, 90], lng dalam [-180, 180]; lempar error dengan pesan yang menyebutkan parameter mana yang tidak valid beserta nilainya jika di luar rentang
    - Implementasi formula haversine menggunakan radius bumi 6371000 meter
    - Fungsi harus pure (tidak ada side effect, tidak ada I/O)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 2.2 Write property tests for `haversineDistance`
    - **Property 10: Zero-distance — `haversineDistance(lat, lng, lat, lng) <= 1e-9`**
    - **Validates: Requirements 7.2**
    - **Property 11: Symmetry — `|haversineDistance(A,B) - haversineDistance(B,A)| <= 1e-9`**
    - **Validates: Requirements 7.3**
    - **Property 12: Non-negativity — result >= 0 untuk semua input valid**
    - **Validates: Requirements 7.4**
    - **Property 13: Determinism — dua panggilan dengan input sama menghasilkan nilai identik**
    - **Validates: Requirements 7.7**
    - **Property 14: Out-of-range inputs throw error dengan pesan deskriptif**
    - **Validates: Requirements 7.5**
    - Tambahkan unit test: jarak Jakarta (−6.2, 106.8) ke Bandung (−6.9, 107.6) ≈ 120km (toleransi ±5km)
    - File: `src/utils/geo.test.ts`

- [x] 3. Implement `src/utils/gacha.ts` — Weighted random selection utility
  - [x] 3.1 Implement `weightedRandom` function
    - Ekspor fungsi generik `weightedRandom<T>(items: T[], weights: number[]): T`
    - Validasi: lempar error jika `items` atau `weights` kosong, jika panjang tidak sama, atau jika semua weight ≤ 0
    - Implementasi cumulative weight selection menggunakan `Math.random()`
    - Fungsi harus pure (tidak ada side effect, tidak ada operasi database atau I/O)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [ ]* 3.2 Write property tests for `weightedRandom`
    - **Property 5: Result selalu anggota input — `items.includes(weightedRandom(items, weights))`**
    - **Validates: Requirements 3.5, 8.6**
    - **Property 15: Mismatched array lengths throw error**
    - **Validates: Requirements 8.3**
    - **Property 16: All-non-positive weights throw error**
    - **Validates: Requirements 8.4**
    - Tambahkan unit test: single item selalu dikembalikan; empty array throw; distribusi mendekati bobot (statistical)
    - File: `src/utils/gacha.test.ts`

- [x] 4. Checkpoint — Pastikan semua tests utility pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement `src/lib/supabase/queries.ts` — Query layer
  - [x] 5.1 Implement TypeScript types dan `parsePostGISPoint` / `formatToPostGISPoint`
    - Definisikan interface `Restaurant`, `RestaurantWithDistance`, `RestaurantWithCoords` sesuai design document
    - Implementasi `formatToPostGISPoint(lat: number, lng: number): string` — menghasilkan WKT `POINT(lng lat)`; lempar error jika lat di luar [-90, 90] atau lng di luar [-180, 180]
    - Implementasi `parsePostGISPoint(geographyValue: unknown): { lat: number; lng: number }` — handle GeoJSON `{ type: "Point", coordinates: [lng, lat] }` dan WKT `POINT(lng lat)`; lempar error dengan pesan deskriptif untuk format tidak valid
    - Import `supabase` dari `@/lib/supabase/client` (tidak membuat instance baru)
    - _Requirements: 9.5, 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 5.2 Write property tests for PostGIS coordinate functions
    - **Property 17: Round-trip — `parsePostGISPoint(formatToPostGISPoint(lat, lng))` menghasilkan `{ lat, lng }` dengan selisih ≤ 1e-9**
    - **Validates: Requirements 11.5**
    - **Property 18: `formatToPostGISPoint` rejects out-of-range coordinates**
    - **Validates: Requirements 11.4**
    - **Property 19: `parsePostGISPoint` rejects invalid formats**
    - **Validates: Requirements 11.2**
    - File: `src/lib/supabase/queries.test.ts`

  - [x] 5.3 Implement `getEligibleRestaurants`
    - Implementasi `getEligibleRestaurants(budget, radiusMeters, userLat, userLng): Promise<RestaurantWithDistance[]>`
    - Query Supabase dengan filter: `hygiene_score >= 50`, `price_tier <= budget`, dan `ST_DistanceSphere(location, ST_MakePoint(lng, lat)) <= radiusMeters`
    - Sertakan field `distance` (integer meter, dibulatkan) dalam hasil
    - Lempar error dengan pesan deskriptif jika query gagal
    - _Requirements: 9.1, 1.1, 2.1_

  - [x] 5.4 Implement `getAllRestaurants`
    - Implementasi `getAllRestaurants(): Promise<RestaurantWithCoords[]>`
    - Query semua restaurant dari Supabase
    - Parse kolom `location` menggunakan `parsePostGISPoint` untuk menghasilkan field `lat` dan `lng`
    - Tambahkan field `hygiene_status`: `"RED"` jika `hygiene_score < 50`, `"GREEN"` jika `>= 50`
    - Lempar error dengan pesan deskriptif jika query gagal
    - _Requirements: 9.2, 4.1, 4.2, 4.3_

  - [ ]* 5.5 Write property test for hygiene status classification
    - **Property 7: `hygiene_status` = `"RED"` jika score < 50, `"GREEN"` jika score >= 50 (termasuk tepat 50)**
    - **Validates: Requirements 4.3**
    - Tambahkan unit test (mocked Supabase): `getAllRestaurants` mengembalikan array kosong jika DB kosong
    - File: `src/lib/supabase/queries.test.ts`

  - [x] 5.6 Implement `saveHygieneReport`
    - Implementasi `saveHygieneReport(restaurantId, reportType, description?): Promise<void>`
    - Insert ke tabel `hygiene_reports` dengan `user_id: null` (Guest Mode)
    - Lempar error dengan pesan deskriptif jika insert gagal
    - _Requirements: 9.3, 5.6_

  - [x] 5.7 Implement `updateHygieneScore`
    - Implementasi `updateHygieneScore(restaurantId, reportType): Promise<Restaurant>`
    - Ambil `hygiene_score` saat ini dari DB
    - Hitung score baru: `max(0, score - 50)` untuk `RED_FLAG`, `min(100, score + 20)` untuk `CLEAN`
    - Jika score baru < 50, set `is_verified_safe = false`
    - Update DB dan kembalikan data restaurant yang telah diperbarui
    - Lempar error dengan pesan deskriptif jika operasi gagal
    - _Requirements: 9.4, 6.1, 6.2, 6.3, 6.4_

  - [ ]* 5.8 Write unit tests for `saveHygieneReport` and `updateHygieneScore` (mocked)
    - Mock `@/lib/supabase/client` menggunakan `vi.mock`
    - Test `saveHygieneReport` menyimpan dengan `user_id = null`
    - Test `updateHygieneScore` RED_FLAG: `max(0, score - 50)`
    - Test `updateHygieneScore` CLEAN: `min(100, score + 20)`
    - Test `updateHygieneScore` sets `is_verified_safe = false` ketika score baru < 50
    - File: `src/lib/supabase/queries.test.ts`

- [x] 6. Checkpoint — Pastikan semua tests query layer pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement `src/app/api/spin/route.ts` — POST /api/spin
  - [x] 7.1 Implement spin route handler
    - Ekspor `async function POST(request: Request): Promise<Response>`
    - Parse JSON body dan validasi semua parameter wajib: `budget`, `radius`, `user_lat`, `user_lng`
    - Validasi range: `budget` integer 1–100.000.000; `radius` integer 1–50.000; `user_lat` float [-90, 90]; `user_lng` float [-180, 180]
    - Kembalikan `Response.json({ error, code: "INVALID_INPUT" }, { status: 400 })` untuk input tidak valid
    - Panggil `getEligibleRestaurants(budget, radius, user_lat, user_lng)`
    - Kembalikan `Response.json({ error, code: "NO_ELIGIBLE_RESTAURANTS" }, { status: 404 })` jika hasil kosong
    - Hitung weights: `max(1, budget - price_tier)` untuk setiap restaurant
    - Panggil `weightedRandom(candidates, weights)` untuk memilih 1 restaurant
    - Kembalikan `Response.json({ data: { id, name, category, price_tier, distance, hygiene_score } }, { status: 200 })`
    - Tangkap semua exception dalam try/catch; kembalikan `DATABASE_ERROR` (500) untuk DB error, `INTERNAL_ERROR` (500) untuk lainnya
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 10.1, 10.2, 10.3, 10.6, 10.7_

  - [ ]* 7.2 Write property tests for spin handler
    - Mock `@/lib/supabase/queries` dan `@/utils/gacha` menggunakan `vi.mock`
    - **Property 1: Hygiene filter — hasil tidak mengandung restaurant dengan score < 50**
    - **Validates: Requirements 1.1**
    - **Property 2: Budget+radius filter — hasil hanya mengandung restaurant dengan `price_tier <= budget` dan `distance <= radius`**
    - **Validates: Requirements 2.1**
    - **Property 3: Out-of-range params — request dengan parameter di luar range mengembalikan 400 INVALID_INPUT**
    - **Validates: Requirements 2.3**
    - **Property 4: Weight formula — weight = `max(1, budget - price_tier)` untuk setiap restaurant**
    - **Validates: Requirements 3.1**
    - **Property 6: Response fields — response sukses mengandung semua 6 field wajib**
    - **Validates: Requirements 3.3**
    - Tambahkan unit test: missing params → 400; empty result → 404; DB error → 500
    - File: `src/app/api/spin/route.test.ts`

- [x] 8. Implement `src/app/api/restaurants/route.ts` — GET /api/restaurants
  - [x] 8.1 Implement restaurants route handler
    - Ekspor `async function GET(request: Request): Promise<Response>`
    - Panggil `getAllRestaurants()`
    - Kembalikan `Response.json({ data: restaurants }, { status: 200 })` — array kosong `[]` jika tidak ada data
    - Tangkap exception DB: kembalikan `Response.json({ error, code: "DATABASE_ERROR" }, { status: 500 })`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 10.1, 10.2, 10.5, 10.6, 10.7_

  - [ ]* 8.2 Write unit tests for restaurants handler (mocked)
    - Mock `@/lib/supabase/queries`
    - Test: response sukses mengandung field `lat`, `lng`, `hygiene_status` untuk setiap restaurant
    - Test: DB kosong mengembalikan `{ data: [] }` dengan status 200 (bukan error)
    - Test: DB error mengembalikan `{ code: "DATABASE_ERROR" }` dengan status 500
    - File: `src/app/api/restaurants/route.test.ts`

- [x] 9. Implement `src/app/api/report/route.ts` — POST /api/report
  - [x] 9.1 Implement report route handler
    - Ekspor `async function POST(request: Request): Promise<Response>`
    - Parse JSON body dan validasi semua parameter
    - Validasi `restaurant_id`: wajib ada, harus string UUID format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`; kembalikan 400 `INVALID_INPUT` jika tidak valid
    - Validasi `report_type`: wajib ada, harus `"RED_FLAG"` atau `"CLEAN"`; kembalikan 400 `INVALID_REPORT_TYPE` jika tidak valid
    - Validasi `description` (opsional): jika ada dan panjang > 1000 karakter, kembalikan 400 `INVALID_INPUT`
    - Cek keberadaan restaurant di DB; kembalikan 404 `RESTAURANT_NOT_FOUND` jika tidak ditemukan
    - Panggil `saveHygieneReport(restaurantId, reportType, description)`
    - Panggil `updateHygieneScore(restaurantId, reportType)`; jika gagal, kembalikan 200 dengan data restaurant sebelum update
    - Kembalikan `Response.json({ data: updatedRestaurant }, { status: 200 })` jika semua berhasil
    - Tangkap semua exception dalam try/catch
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 10.1, 10.2, 10.3, 10.4, 10.6, 10.7_

  - [ ]* 9.2 Write property tests for report handler
    - Mock `@/lib/supabase/queries`
    - **Property 8: Score update invariant — score setelah update selalu dalam [0, 100] untuk semua score awal valid**
    - **Validates: Requirements 6.1, 6.2, 6.7**
    - **Property 9: `is_verified_safe` = false ketika RED_FLAG menyebabkan score < 50**
    - **Validates: Requirements 6.3**
    - **Property 20: UUID validation — non-UUID string mengembalikan 400 INVALID_INPUT**
    - **Validates: Requirements 5.2**
    - **Property 21: `report_type` validation — nilai selain "RED_FLAG"/"CLEAN" mengembalikan 400 INVALID_REPORT_TYPE**
    - **Validates: Requirements 5.3**
    - **Property 22: Description length — description > 1000 karakter mengembalikan 400 INVALID_INPUT**
    - **Validates: Requirements 5.4**
    - Tambahkan unit test: valid report → 200 dengan data updated; RESTAURANT_NOT_FOUND → 404; partial failure (saveOK, updateFail) → 200 dengan pre-update data
    - File: `src/app/api/report/route.test.ts`

- [x] 10. Fix database schema — make `user_id` nullable in `hygiene_reports`
  - Edit `supabase/schema.sql`: ubah kolom `user_id` di tabel `hygiene_reports` dari `NOT NULL` menjadi nullable (hapus constraint `NOT NULL`)
  - _Requirements: 5.6, 9.3_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks bertanda `*` bersifat opsional dan dapat dilewati untuk MVP yang lebih cepat
- Setiap task mereferensikan requirement spesifik untuk traceability
- Route handlers menggunakan `Response.json()` (bukan `NextResponse`) sesuai Next.js 16 App Router
- Next.js 16 menggunakan Turbopack secara default untuk `next build` — tidak perlu konfigurasi webpack tambahan
- Vitest memerlukan `vitest.config.mts` dengan `vite-tsconfig-paths` agar path alias `@/*` berfungsi
- Semua test yang melibatkan Supabase menggunakan `vi.mock('@/lib/supabase/client')` untuk isolasi
- Jalankan test dengan `npx vitest --run` (single run, bukan watch mode)
- Schema fix (task 10) perlu diapply ke Supabase sebelum endpoint `/api/report` dapat berfungsi di production

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "3.1"] },
    { "id": 1, "tasks": ["2.2", "3.2"] },
    { "id": 2, "tasks": ["5.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 4, "tasks": ["5.5", "5.6", "5.7"] },
    { "id": 5, "tasks": ["5.8", "7.1", "8.1"] },
    { "id": 6, "tasks": ["7.2", "8.2", "9.1"] },
    { "id": 7, "tasks": ["9.2", "10"] }
  ]
}
```
