# Requirements Document

## Introduction

Fitur Back-End **Gacha Makan** adalah lapisan API dan utilitas server-side untuk aplikasi Next.js yang membantu mahasiswa Jatinangor menemukan warung makan secara acak berdasarkan budget dan radius lokasi. Sistem ini terdiri dari tiga Next.js Route Handlers (`/api/spin`, `/api/restaurants`, `/api/report`), dua pure-function utility module (`gacha.ts`, `geo.ts`), dan satu query layer (`queries.ts`) yang berinteraksi dengan database Supabase (PostgreSQL + PostGIS).

Semua endpoint beroperasi dalam **Guest Mode** (tanpa autentikasi) untuk MVP. Algoritma gacha menerapkan filter keamanan higienitas secara mutlak sebelum melakukan seleksi acak berbobot, sehingga warung dengan skor higienitas rendah tidak pernah muncul sebagai hasil spin.

---

## Glossary

- **API_Handler**: Next.js Route Handler yang didefinisikan dalam `src/app/api/` menggunakan konvensi App Router (`route.ts`).
- **Spin_Engine**: Modul yang mengeksekusi alur lengkap algoritma gacha — filter mutlak, filter user, dan weighted random selection.
- **Gacha_Util**: Pure function di `src/utils/gacha.ts` yang melakukan weighted random selection tanpa side effect database.
- **Geo_Util**: Pure function di `src/utils/geo.ts` yang menghitung jarak antara dua koordinat geografis.
- **Query_Layer**: Kumpulan fungsi di `src/lib/supabase/queries.ts` yang mengabstraksi semua operasi baca/tulis ke Supabase.
- **Supabase_Client**: Instance `supabase` yang diekspor dari `src/lib/supabase/client.ts`.
- **Restaurant**: Entitas warung makan yang tersimpan di tabel `restaurants` dengan kolom: `id`, `name`, `category`, `price_tier`, `location` (PostGIS geography), `hygiene_score`, `is_verified_safe`.
- **Hygiene_Report**: Entitas laporan kebersihan yang tersimpan di tabel `hygiene_reports` dengan kolom: `id`, `user_id`, `restaurant_id`, `report_type`, `description`, `created_at`.
- **Hygiene_Score**: Nilai integer antara 0–100 yang merepresentasikan skor kebersihan sebuah Restaurant. Nilai default adalah 100.
- **Red_Flag_Threshold**: Nilai Hygiene_Score di bawah 50 yang menyebabkan Restaurant dikecualikan dari hasil spin dan ditandai sebagai tidak aman.
- **Price_Tier**: Nilai integer dalam Rupiah yang merepresentasikan estimasi harga maksimal sebuah Restaurant.
- **Weight**: Nilai numerik yang dihitung dari selisih antara budget user dan Price_Tier sebuah Restaurant, digunakan dalam weighted random selection.
- **Guest_User**: Pengguna yang mengakses endpoint tanpa autentikasi; `user_id` bernilai `null` untuk entitas yang dibuat oleh Guest_User.
- **Error_Response**: Objek JSON dengan format `{ "error": string, "code": string }` yang dikembalikan saat terjadi kegagalan.
- **Success_Response**: Objek JSON dengan format `{ "data": T }` yang dikembalikan saat operasi berhasil.
- **PostGIS**: Ekstensi PostgreSQL untuk operasi geospasial, tersedia di Supabase. Fungsi `ST_DistanceSphere` digunakan untuk menghitung jarak dalam meter.
- **Haversine**: Formula matematika untuk menghitung jarak antara dua titik di permukaan bola berdasarkan koordinat lintang dan bujur, digunakan sebagai fallback jika PostGIS tidak tersedia.

---

## Requirements

### Requirement 1: Endpoint Spin — Filter Mutlak Higienitas

**User Story:** Sebagai mahasiswa, saya ingin sistem tidak pernah merekomendasikan warung dengan skor higienitas rendah, sehingga saya terlindungi dari risiko kesehatan tanpa perlu memeriksa secara manual.

#### Acceptance Criteria

1. WHEN endpoint `/api/spin` menerima request POST, THE Spin_Engine SHALL menghasilkan daftar kandidat yang tidak mengandung Restaurant dengan Hygiene_Score kurang dari 50, terlepas dari filter lain yang diterapkan setelahnya.
2. IF tidak ada Restaurant yang tersisa setelah semua filter (higienitas, budget, dan radius) diterapkan — termasuk kasus database kosong, semua warung di bawah threshold, atau semua warung tersaring oleh budget/radius — THEN THE API_Handler SHALL mengembalikan Error_Response dengan `code: "NO_ELIGIBLE_RESTAURANTS"` dan HTTP status 404.

---

### Requirement 2: Endpoint Spin — Filter Budget dan Radius

**User Story:** Sebagai mahasiswa, saya ingin hasil gacha hanya menampilkan warung yang sesuai dengan budget dan jarak yang saya tentukan, sehingga rekomendasi selalu relevan dengan kondisi saya.

#### Acceptance Criteria

1. WHEN endpoint `/api/spin` menerima request POST dengan parameter `budget` (integer, Rupiah), `radius` (integer, meter), `user_lat` (float), dan `user_lng` (float), THE Spin_Engine SHALL mengecualikan semua Restaurant dengan Price_Tier lebih besar dari nilai `budget` DAN mengecualikan semua Restaurant yang jaraknya (dihitung menggunakan `ST_DistanceSphere` PostGIS) lebih besar dari nilai `radius` dalam meter.
2. IF parameter `budget`, `radius`, `user_lat`, atau `user_lng` tidak ada dalam request body, THEN THE API_Handler SHALL mengembalikan Error_Response dengan `code: "INVALID_INPUT"` dan HTTP status 400.
3. IF parameter `budget` bukan integer positif (1 hingga 100.000.000), ATAU `radius` bukan integer positif (1 hingga 50.000 meter), ATAU `user_lat` bukan float dalam rentang -90 hingga 90, ATAU `user_lng` bukan float dalam rentang -180 hingga 180, THEN THE API_Handler SHALL mengembalikan Error_Response dengan `code: "INVALID_INPUT"` dan HTTP status 400.
4. IF tidak ada Restaurant yang tersisa setelah semua filter (higienitas, budget, dan radius) diterapkan secara berurutan, THEN THE API_Handler SHALL mengembalikan Error_Response dengan `code: "NO_ELIGIBLE_RESTAURANTS"` dan HTTP status 404 tanpa menyertakan saran untuk memperluas filter.
5. IF terjadi kegagalan database saat menjalankan query filter, THEN THE API_Handler SHALL mengembalikan Error_Response dengan `code: "DATABASE_ERROR"` dan HTTP status 500.

---

### Requirement 3: Endpoint Spin — Weighted Random Selection

**User Story:** Sebagai mahasiswa, saya ingin warung yang lebih murah memiliki peluang lebih besar untuk terpilih, sehingga rekomendasi cenderung ramah di kantong.

#### Acceptance Criteria

1. WHEN Spin_Engine memiliki daftar kandidat Restaurant yang telah lolos semua filter, THE Gacha_Util SHALL menghitung Weight setiap Restaurant sebagai `max(1, budget - price_tier)` untuk memastikan setiap Restaurant memiliki peluang minimal.
2. WHEN Gacha_Util melakukan seleksi, THE Gacha_Util SHALL memilih tepat 1 Restaurant secara acak berbobot berdasarkan nilai Weight masing-masing Restaurant.
3. WHEN seleksi berhasil, THE API_Handler SHALL mengembalikan Success_Response dengan `data` berisi objek Restaurant yang memiliki field: `id`, `name`, `category`, `price_tier`, `distance` (dalam meter, dibulatkan ke integer), dan `hygiene_score`.
4. THE Gacha_Util SHALL berupa pure function yang tidak melakukan operasi database dan tidak memiliki side effect.
5. THE result of Gacha_Util SHALL selalu merupakan salah satu Restaurant dari daftar kandidat yang diberikan (invariant: output selalu anggota input).

---

### Requirement 4: Endpoint Restaurants — Pengambilan Data Peta

**User Story:** Sebagai mahasiswa, saya ingin melihat semua warung di peta beserta status higienitasnya, sehingga saya bisa membuat keputusan berdasarkan informasi visual.

#### Acceptance Criteria

1. WHEN endpoint `/api/restaurants` menerima request GET, THE API_Handler SHALL mengembalikan Success_Response dengan `data` berisi array semua Restaurant yang tersimpan di database, di mana setiap objek memiliki field: `id`, `name`, `category`, `price_tier`, `hygiene_score`, `is_verified_safe`, `lat` (float), `lng` (float), dan `hygiene_status` (string `"RED"` atau `"GREEN"`).
2. WHEN Query_Layer mengambil data Restaurant, THE Query_Layer SHALL mengekstrak koordinat dari kolom `location` (PostGIS geography) dan mengembalikannya sebagai field `lat` (float) dan `lng` (float) yang terpisah.
3. WHEN Query_Layer menyusun data Restaurant, THE Query_Layer SHALL menyertakan field `hygiene_status` dengan nilai `"RED"` jika Hygiene_Score kurang dari 50, dan nilai `"GREEN"` jika Hygiene_Score 50 atau lebih (termasuk tepat 50).
4. WHEN endpoint `/api/restaurants` menerima request GET dan tidak ada Restaurant di database, THE API_Handler SHALL mengembalikan Success_Response dengan `data` berisi array kosong `[]`, bukan Error_Response.
5. IF terjadi kegagalan database (termasuk kegagalan koneksi, query timeout, atau permission error), THEN THE API_Handler SHALL mengembalikan Error_Response dengan `code: "DATABASE_ERROR"` dan HTTP status 500 secara langsung tanpa mencoba mengembalikan data cache atau array kosong.

---

### Requirement 5: Endpoint Report — Penerimaan Laporan Kebersihan

**User Story:** Sebagai mahasiswa, saya ingin melaporkan kondisi kebersihan warung yang saya kunjungi, sehingga komunitas mendapat informasi yang akurat dan terkini.

#### Acceptance Criteria

1. THE API_Handler SHALL memvalidasi semua parameter wajib (`restaurant_id`, `report_type`) sebelum memproses laporan; laporan dengan parameter tidak valid SHALL ditolak tanpa menyimpan data apapun.
2. IF parameter `restaurant_id` tidak ada atau bukan string UUID yang valid (format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`), THEN THE API_Handler SHALL mengembalikan Error_Response dengan `code: "INVALID_INPUT"` dan HTTP status 400 tanpa menyimpan laporan.
3. IF parameter `report_type` tidak ada atau bukan salah satu dari nilai `"RED_FLAG"` atau `"CLEAN"`, THEN THE API_Handler SHALL mengembalikan Error_Response dengan `code: "INVALID_REPORT_TYPE"` dan HTTP status 400.
4. IF parameter `description` ada dan panjangnya melebihi 1000 karakter, THEN THE API_Handler SHALL mengembalikan Error_Response dengan `code: "INVALID_INPUT"` dan HTTP status 400.
5. IF `restaurant_id` tidak ditemukan di tabel `restaurants`, THEN THE API_Handler SHALL mengembalikan Error_Response dengan `code: "RESTAURANT_NOT_FOUND"` dan HTTP status 404.
6. WHEN laporan valid diterima, THE Query_Layer SHALL menyimpan entri baru ke tabel `hygiene_reports` dengan `user_id` bernilai `null` (kolom harus nullable untuk mendukung Guest_User), `restaurant_id`, `report_type`, dan `description` yang diberikan, lalu THE API_Handler SHALL mengembalikan Success_Response dengan HTTP status 200.

---

### Requirement 6: Endpoint Report — Pembaruan Hygiene Score

**User Story:** Sebagai mahasiswa, saya ingin laporan kebersihan langsung berdampak pada skor warung, sehingga sistem selalu mencerminkan kondisi terkini.

#### Acceptance Criteria

1. WHEN laporan dengan `report_type: "RED_FLAG"` berhasil disimpan, THE Query_Layer SHALL mengurangi Hygiene_Score Restaurant terkait sebesar 50 poin, dengan nilai minimum 0 (`max(0, current_score - 50)`).
2. WHEN laporan dengan `report_type: "CLEAN"` berhasil disimpan, THE Query_Layer SHALL menambah Hygiene_Score Restaurant terkait sebesar 20 poin, dengan nilai maksimum 100 (`min(100, current_score + 20)`).
3. WHEN Hygiene_Score Restaurant menjadi kurang dari 50 setelah pembaruan, THE Query_Layer SHALL secara otomatis mengatur kolom `is_verified_safe` Restaurant tersebut menjadi `false`.
4. WHEN Hygiene_Score Restaurant 50 atau lebih setelah pembaruan laporan `"CLEAN"`, THE Query_Layer SHALL membiarkan nilai `is_verified_safe` tidak berubah (tidak otomatis menjadi `true`).
5. WHEN laporan berhasil diproses dan Hygiene_Score berhasil diperbarui, THE API_Handler SHALL mengembalikan Success_Response dengan `data` berisi objek Restaurant yang telah diperbarui, termasuk Hygiene_Score dan `is_verified_safe` terbaru.
6. IF laporan berhasil disimpan ke tabel `hygiene_reports` tetapi operasi pembaruan Hygiene_Score gagal, THEN THE API_Handler SHALL mengembalikan Success_Response dengan `data` berisi data Restaurant sebelum pembaruan.
7. THE Hygiene_Score setelah pembaruan SHALL selalu berada dalam rentang 0 hingga 100 inklusif untuk semua nilai awal dan jenis laporan yang valid (invariant: score selalu dalam batas).

---

### Requirement 7: Geo Utility — Kalkulasi Jarak

**User Story:** Sebagai developer, saya ingin ada fungsi kalkulasi jarak yang andal dengan fallback, sehingga fitur berbasis lokasi tetap berfungsi meski PostGIS tidak tersedia.

#### Acceptance Criteria

1. THE Geo_Util SHALL mengekspor fungsi `haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number` yang mengembalikan jarak dalam meter antara dua koordinat geografis.
2. WHEN `haversineDistance` dipanggil dengan dua pasang koordinat yang identik, THE Geo_Util SHALL mengembalikan nilai yang kurang dari atau sama dengan 1e-9 meter (secara efektif 0).
3. WHEN `haversineDistance` dipanggil dengan koordinat A ke B, THE Geo_Util SHALL mengembalikan nilai yang selisihnya tidak lebih dari 1e-9 meter dengan pemanggilan dari koordinat B ke A (simetri jarak).
4. WHEN `haversineDistance` dipanggil dengan koordinat yang valid (lat ∈ [-90, 90], lng ∈ [-180, 180]), THE Geo_Util SHALL mengembalikan nilai non-negatif.
5. IF salah satu parameter berada di luar rentang valid (lat di luar [-90, 90] atau lng di luar [-180, 180]), THEN THE Geo_Util SHALL melempar error dengan pesan yang menyebutkan parameter mana yang tidak valid dan nilai yang diterima.
6. THE Geo_Util SHALL berupa pure function yang tidak memiliki side effect dan tidak melakukan operasi I/O apapun.
7. THE `haversineDistance` SHALL menghasilkan nilai yang sama setiap kali dipanggil dengan input yang sama (determinisme).

---

### Requirement 8: Gacha Utility — Weighted Random Selection

**User Story:** Sebagai developer, saya ingin algoritma weighted random terisolasi sebagai pure function yang mudah diuji, sehingga logika seleksi dapat diverifikasi secara independen dari database.

#### Acceptance Criteria

1. THE Gacha_Util SHALL mengekspor fungsi `weightedRandom<T>(items: T[], weights: number[]): T` yang menerima array item dan array bobot dengan panjang yang sama, lalu mengembalikan satu item.
2. IF array `items` kosong atau array `weights` kosong, THEN THE Gacha_Util SHALL melempar error dengan pesan yang deskriptif.
3. IF panjang array `items` tidak sama dengan panjang array `weights`, THEN THE Gacha_Util SHALL melempar error dengan pesan yang deskriptif.
4. IF semua nilai dalam array `weights` adalah 0 atau negatif, THEN THE Gacha_Util SHALL melempar error dengan pesan yang deskriptif.
5. WHEN `weightedRandom` dipanggil dengan satu item, THE Gacha_Util SHALL selalu mengembalikan item tersebut.
6. FOR ALL array `items` dan `weights` yang valid, hasil `weightedRandom` SHALL selalu merupakan salah satu elemen dari array `items` (invariant: output selalu anggota input).
7. THE Gacha_Util SHALL berupa pure function yang tidak memiliki side effect dan tidak melakukan operasi database atau I/O apapun.

---

### Requirement 9: Query Layer — Abstraksi Database

**User Story:** Sebagai developer, saya ingin semua operasi database terpusat di satu modul, sehingga API handlers tetap bersih dan operasi database mudah di-mock saat testing.

#### Acceptance Criteria

1. THE Query_Layer SHALL mengekspor fungsi `getEligibleRestaurants(budget: number, radiusMeters: number, userLat: number, userLng: number): Promise<RestaurantWithDistance[]>` yang mengembalikan array Restaurant dengan Hygiene_Score ≥ 50, Price_Tier ≤ budget, dan jarak ≤ radiusMeters, beserta field `distance` (integer, meter, dibulatkan).
2. THE Query_Layer SHALL mengekspor fungsi `getAllRestaurants(): Promise<RestaurantWithCoords[]>` yang mengembalikan semua Restaurant dengan field `lat`, `lng`, dan `hygiene_status` (`"RED"` jika Hygiene_Score < 50, `"GREEN"` jika ≥ 50).
3. THE Query_Layer SHALL mengekspor fungsi `saveHygieneReport(restaurantId: string, reportType: 'RED_FLAG' | 'CLEAN', description?: string): Promise<void>` yang menyimpan laporan ke tabel `hygiene_reports` dengan `user_id` bernilai `null`.
4. THE Query_Layer SHALL mengekspor fungsi `updateHygieneScore(restaurantId: string, reportType: 'RED_FLAG' | 'CLEAN'): Promise<Restaurant>` yang memperbarui Hygiene_Score (`max(0, score - 50)` untuk RED_FLAG, `min(100, score + 20)` untuk CLEAN), mengatur `is_verified_safe` menjadi `false` jika score baru < 50, lalu mengembalikan data Restaurant yang telah diperbarui.
5. WHEN Query_Layer menggunakan Supabase sebagai database, THE Query_Layer SHALL mengimpor instance `supabase` dari `src/lib/supabase/client.ts` dan tidak membuat instance Supabase baru.
6. IF operasi database di Query_Layer gagal, THEN THE Query_Layer SHALL melempar error dengan pesan yang mengidentifikasi operasi yang gagal dan alasan kegagalannya agar dapat ditangkap oleh API_Handler.

---

### Requirement 10: Konsistensi Format Response dan Error Handling

**User Story:** Sebagai developer front-end, saya ingin semua endpoint mengembalikan format JSON yang konsisten, sehingga penanganan response di sisi klien dapat distandarisasi.

#### Acceptance Criteria

1. THE API_Handler SHALL mengembalikan semua response dalam format `Content-Type: application/json`.
2. IF operasi berhasil, THEN THE API_Handler SHALL mengembalikan objek JSON dengan field `data` yang berisi payload hasil operasi dan HTTP status 200.
3. IF terjadi error validasi input, THEN THE API_Handler SHALL mengembalikan objek JSON dengan field `error` (string deskriptif) dan field `code` (string konstanta non-kosong) dengan HTTP status 400.
4. IF terjadi error resource tidak ditemukan, THEN THE API_Handler SHALL mengembalikan objek JSON dengan field `error` (string deskriptif) dan field `code` (string konstanta non-kosong) dengan HTTP status 404.
5. IF terjadi error internal server atau kegagalan database, THEN THE API_Handler SHALL mengembalikan objek JSON dengan field `error` dan field `code` yang sesuai — `code: "DATABASE_ERROR"` untuk semua kegagalan database (koneksi, timeout, permission), atau `code: "INTERNAL_ERROR"` untuk error server lainnya — dengan HTTP status 500.
6. THE API_Handler SHALL menggunakan Next.js `Response` object (bukan `NextResponse`) sesuai konvensi Route Handler App Router untuk membuat response JSON.
7. IF terjadi exception di dalam scope try/catch API_Handler, THEN THE API_Handler SHALL menangkap exception tersebut dan mengembalikan Error_Response dengan HTTP status 500; exception yang terjadi di luar scope API_Handler (misalnya di middleware) diserahkan ke framework untuk ditangani.

---

### Requirement 11: Parser dan Serializer Koordinat PostGIS

**User Story:** Sebagai developer, saya ingin ada fungsi yang andal untuk mengkonversi format koordinat PostGIS ke format lat/lng standar dan sebaliknya, sehingga data lokasi selalu konsisten antara database dan API.

#### Acceptance Criteria

1. THE Query_Layer SHALL mengekspor fungsi `parsePostGISPoint(geographyValue: unknown): { lat: number; lng: number }` yang mengkonversi nilai geography PostGIS — baik GeoJSON Geometry object dengan `type: "Point"` dan `coordinates: [longitude, latitude]`, maupun WKT string format `POINT(lng lat)` — menjadi objek dengan field `lat` dan `lng`.
2. IF nilai geography yang diberikan ke `parsePostGISPoint` tidak dapat diparse (format tidak dikenali, tipe bukan "Point", atau koordinat tidak valid), THEN THE Query_Layer SHALL melempar error dengan pesan yang menyebutkan format yang diterima dan nilai/tipe input yang menyebabkan kegagalan.
3. THE Query_Layer SHALL mengekspor fungsi `formatToPostGISPoint(lat: number, lng: number): string` yang mengkonversi koordinat lat/lng menjadi string WKT format `POINT(lng lat)` untuk digunakan dalam query Supabase.
4. IF `formatToPostGISPoint` dipanggil dengan lat di luar rentang [-90, 90] atau lng di luar rentang [-180, 180], THEN THE Query_Layer SHALL melempar error dengan pesan yang menyebutkan parameter mana yang tidak valid dan nilai yang diterima.
5. THE round-trip `parsePostGISPoint(formatToPostGISPoint(lat, lng))` SHALL menghasilkan objek `{ lat, lng }` di mana selisih absolut antara nilai input dan output tidak melebihi 1e-9 untuk semua koordinat valid (round-trip property).
