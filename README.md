# Gacha Makan

Aplikasi web untuk mahasiswa yang lapar tapi tidak bisa memutuskan mau makan
apa. Atur budget dan radius, tekan satu tombol, dan kamu dapat **satu**
warung. Daftar dua puluh pilihan cuma bikin keputusannya makin berat.

Cakupannya sengaja sempit: **Jatinangor, lalu Bandung.** Google Maps menang
soal cakupan. Kami bersaing di kurasi lokal: jam buka yang benar, harga yang
benar, dan warung yang memang didatangi mahasiswa.

Aplikasi ini memakai dua jenis AI dengan peran terpisah. **LLM** membereskan
data katalog, dan **contextual bandit** belajar warung mana yang cocok untuk
siapa. Penjelasan lengkapnya ada di
[AI dan machine learning](#ai-dan-machine-learning).

---

## Daftar isi

- [Fitur](#fitur)
- [Cara pakai](#cara-pakai)
- [Cara kerja spin](#cara-kerja-spin)
- [Skor kebersihan](#skor-kebersihan)
- [AI dan machine learning](#ai-dan-machine-learning)
  - [Dua jenis AI, dua peran](#dua-jenis-ai-dua-peran)
  - [Kurasi kategori dengan LLM](#kurasi-kategori-dengan-llm)
  - [Evaluasi kategorisasi](#evaluasi-kategorisasi)
  - [Rekomendasi: contextual bandit](#rekomendasi-contextual-bandit)
  - [Evaluasi off-policy](#evaluasi-off-policy)
  - [Penyajian di belakang flag](#penyajian-di-belakang-flag)
  - [Status dan rencana AI](#status-dan-rencana-ai)
- [Tech stack](#tech-stack)
- [Menjalankan secara lokal](#menjalankan-secara-lokal)
- [Perintah](#perintah)
- [Struktur proyek](#struktur-proyek)
- [Keamanan dan keputusan desain](#keamanan-dan-keputusan-desain)
- [Menambah data restoran](#menambah-data-restoran)
- [Metrik](#metrik)
- [Status dan keterbatasan](#status-dan-keterbatasan)
- [Asal proyek](#asal-proyek)
- [Berkontribusi](#berkontribusi)

---

## Fitur

| Halaman | Isi |
|---|---|
| `/` Beranda | Hero, panduan singkat, ringkasan katalog (terdata / aman / perlu dicek), feed laporan kebersihan terbaru |
| `/spin` | Spin utama: lokasi, budget, radius, filter "buka sekarang", lalu satu hasil. Respons: "Jadi ke sini", "Simpan buat nanti", atau spin lagi |
| `/blind` | Blind Roll: pilih preset (Hemat Aman, Comfort, Jelajah, Mepet Banget), tanpa mengatur apa pun |
| `/map` | Peta Leaflet semua tempat, cari nama, filter status kebersihan, kirim laporan Red Flag / Clean |
| `/riwayat` | Riwayat spin dan daftar simpanan, dibaca lewat RLS |
| `/dompet` | Jatah makan bulanan; "Jadi ke sini" memotong saldo kalau harganya diketahui |
| `/hasil/[id]` | Halaman hasil yang bisa dibagikan, lengkap dengan gambar Open Graph |
| `/login`, `/account` | Opsional. Mengaitkan email ke sesi anonim yang sudah berjalan |

Lainnya:

- **Tanpa daftar.** Sesi anonim dibuat otomatis; riwayat dan favorit tetap
  tercatat
- **Lokasi otomatis atau manual.** Izin lokasi boleh ditolak; area bisa
  dipilih dari preset Jatinangor dan Bandung, dan pilihan terakhir diingat
- **Filter diingat** antar kunjungan (`localStorage`)
- **PWA:** bisa dipasang ke home screen, dengan service worker sendiri
- **Saran saat hasil kosong.** Kalau tidak ada kandidat, aplikasi bilang
  kenapa: radius terlalu sempit, budget terlalu kecil, atau semuanya tutup

---

## Cara pakai

1. Buka aplikasinya. **Tidak perlu daftar**; aplikasi membuat sesi anonim di latar
2. Izinkan lokasi, atau pilih area sendiri kalau tidak mau
3. Atur budget dan radius, tekan **SPIN**
4. "Jadi ke sini", "Simpan buat nanti", atau spin lagi

Aplikasi menawarkan akun saat ada data yang bisa hilang. Mendaftar belakangan
**tidak menghapus riwayat**: `updateUser` mengaitkan email ke sesi yang sudah
berjalan, jadi `user_id`-nya tetap sama.

---

## Cara kerja spin

`POST /api/spin` melakukan empat hal:

1. **Rate limit:** 30 spin per menit per IP
2. **Ambil kandidat** lewat fungsi Postgres `get_eligible_restaurants` (PostGIS):
   - `is_active`
   - skor kebersihan **belum ada laporan (null) atau ≥ 50**
   - harga **belum diketahui (null) atau ≤ budget**
   - jarak ≤ radius
   - kalau filter "buka sekarang" aktif: buang yang **pasti** tutup, tapi tetap
     tampilkan yang jam bukanya belum terdata
3. **Pilih satu** dengan undian berbobot (`weighted_budget_v2`):
   - bobot = `max(1, budget − harga)`, jadi tempat yang jauh di bawah budget
     lebih sering keluar
   - harga belum diketahui → bobot 1, sama dengan tempat yang harganya pas
     di batas budget. Kode tidak menebak harga
   - untuk sebagian pengguna, kalau flag-nya dinyalakan, yang memilih adalah
     bandit (lihat [Penyajian di belakang flag](#penyajian-di-belakang-flag))
4. **Catat penayangan** ke `spin_events`: konteks yang dibekukan saat itu,
   nama kebijakan, peluang kebijakan memilih warung ini (`policy_score`), dan
   seluruh kandidat. Respons pengguna dicatat lewat `POST /api/spin/action`

Spin tanpa kandidat dicatat di `spin_misses`, beserta apakah memperlebar radius
atau menaikkan budget akan membantu.

---

## Skor kebersihan

| Nilai | Tampil sebagai | Ikut spin? |
|---|---|---|
| `null` | "Belum ada laporan" | Ya |
| 50–100 | Angka skornya | Ya |
| < 50 | Angka skornya, ditandai merah | Tidak |

- Skor **hanya** berubah lewat laporan pengguna, melalui fungsi database
  `submit_hygiene_report()`
- Red Flag: −50 (minimal 0). Clean: +20 (maksimal 100). Laporan pertama
  dihitung dari titik awal 100
- Cooldown 24 jam per IP per warung, plus rate limit 20 laporan per jam
- Skor turun di bawah 50 mencabut status `is_verified_safe`; skor naik tidak
  memulihkannya otomatis

**Kenapa `null`.** Dulu setiap tempat baru masuk dengan skor 100.
Akibatnya 98% katalog tampil seolah terverifikasi bersih padahal belum pernah
ada satu laporan pun. Rating Google Maps sengaja **tidak** dipakai sebagai
pengganti: rating itu soal rasa dan layanan, bukan kebersihan, dan ToS Google
Maps Platform melarang menyimpannya secara permanen.

---

## AI dan machine learning

Ringkasan di bawah cukup untuk memahami seluruh sistem. Peta berkas, rumus,
semua tabel hasil, mode gagal, dan aturan yang tidak boleh dilanggar ada di
[docs/PENGEMBANGAN-AI.md](docs/PENGEMBANGAN-AI.md).

### Dua jenis AI, dua peran

| | Tugas | Kenapa jenis ini |
|---|---|---|
| **LLM** (Gemini, Ollama lokal, atau Claude) | Membereskan data: menebak kategori masakan dari nama warung | Masalah bahasa. "Ayam Crisbar" jelas warung ayam, tanpa statistik |
| **Contextual bandit** (Thompson Sampling) | Memilih warung yang ditayangkan | Masalah keputusan berulang dengan umpan balik. Harus bisa dievaluasi dan diaudit |

**LLM tidak memilih warung.** Pilihan LLM tidak punya peluang yang bisa
dicatat, dan tanpa angka peluang itu kamu tidak bisa mengevaluasi log-nya
dengan jujur.

```
kurasi kategori (LLM) ───▶ katalog yang lebih kaya
                                   │
                   /api/spin ─▶ spin_events  (konteks + peluang + semua kandidat)
                                   │
                    ekspor dari SQL Editor
                                   │
              ml:evaluate  ─▶  apakah lebih baik dari kebijakan sekarang?
                                   │  ya
              ml:train     ─▶  ml/bandit.json
                                   │
              BANDIT_ROLLOUT ─▶ /api/spin melayani sebagian pengguna
```

Arsitekturnya tetap monolith Next.js, tanpa Python dan tanpa server model
terpisah. Inferensinya cuma perkalian matriks-vektor 26×26 di dalam route
handler.

### Kurasi kategori dengan LLM

**Masalahnya.** Kebanyakan tempat dari OpenStreetMap berkategori "Restaurant"
polos. Di ingest Bandung, 948 dari 1.870 tempat baru jatuh ke slot `lainnya`.
Selama itu belum dibereskan, **12 dari 26 dimensi fitur bandit nyaris
kosong**, dan model tidak bisa belajar soal jenis masakan.

**Caranya.** `npm run ml:categorize` mengirim nama tiap tempat yang masih
`lainnya` ke LLM. Skema JSON membatasi jawabannya ke 12 slot (`ayam`, `mie`,
`nusantara`, `sunda`, `padang`, `chinese`, `jepang_korea`, `barat`, `seafood`,
`kopi_minuman`, `manis_roti`, `lainnya`), plus confidence `rendah` / `sedang` /
`tinggi` dan alasan singkat.

| Provider | Model | Biaya | Catatan |
|---|---|---|---|
| `gemini` | `gemini-3.5-flash-lite` | Free tier; berbayar ~$0,17 per 1.000 warung | **Dipakai untuk kurasi Bandung.** Data free tier boleh dipakai Google, jadi hanya untuk nama OSM publik, jangan untuk teks pengguna |
| `ollama` (default) | `qwen2.5:7b` di laptop | Gratis | ~14 detik per nama di CPU, ~3,8 jam per 1.000 warung. Kalah dari baseline Naive Bayes |
| `claude` | `claude-opus-5-5`, effort `low` | Berbayar | Butuh `ANTHROPIC_API_KEY` |

Pengamannya sama dengan ingest OSM. **Skrip menghasilkan SQL untuk kamu
review, dan tidak menulis langsung ke database**:

- **Yang tidak yakin tidak ditulis.** Slot `lainnya` dan confidence di bawah
  ambang (`--min-confidence`, untuk Gemini dipakai `tinggi`) hanya muncul di
  berkas review
- **Kurasi manusia selalu menang.** Tiap UPDATE menyertakan kategori lamanya
  di `WHERE`, jadi baris yang sudah diubah tangan tidak tertimpa
- **Kategori yang sudah jelas tidak disentuh**
- **Kegagalan tidak dibuang diam-diam.** JSON rusak, id salah salin, atau
  penolakan model tercatat sebagai "tanpa jawaban" di berkas review
- **LLM tidak menebak harga atau jam buka.** Menebaknya berarti membohongi
  filter yang paling sering dipakai

### Evaluasi kategorisasi

Apakah LLM layak dipakai, dan yang mana? Harness evaluasi menjawabnya dengan
test set berlabel manusia.

- **Data:** tag `cuisine` OpenStreetMap dari 12.174 tempat makan di Indonesia,
  dibekukan di `ml/eval/osm-cuisine.json` (ODbL) supaya angkanya bisa diulang
- **Label:** pedoman eksplisit (`GOLD_MAP`), satu item per nama unik, split
  dari hash nama (train 70 / dev 10 / test 20), total 7.346 nama unik
- **Subset berimbang:** paling banyak 50 nama per slot, 509 nama di test.
  Tanpa ini, menebak kelas mayoritas sudah memberi akurasi lumayan
- **Metrik:** macro-F1 sebagai angka utama, interval 95% bootstrap, presisi
  pada saran yang benar-benar akan ditulis, dan uji McNemar untuk
  membandingkan dua metode pada item yang sama
- **Prompt diutak-atik di split dev**, angka akhir dari test

Hasil di test (509 nama):

| Metode | Akurasi | Macro-F1 | Ditulis di ambang `tinggi` → presisi |
|---|---|---|---|
| Aturan kata kunci | 37,1% | 0,39 | 36,5% → 76,3% |
| Naive Bayes n-gram (~100 baris TypeScript) | 56,4% | 0,52 | 80,0% → 59,7% |
| **Gemini 3.5 Flash-Lite** | **65,4%** | **0,66** | 49,7% → **84,2%** |
| Qwen 2.5 7B (Ollama, CPU) | 47,0% | 0,46 | 54,0% → 67,6% |
| Qwen 2.5 3B (Ollama, CPU) | 20,2% | 0,23 | 15,1% → 67,5% |

Angka Gemini dari prompt terbaru; Qwen diukur dengan prompt sebelumnya.

Kesimpulannya:

1. **Gemini dipakai untuk kurasi Bandung**, di ambang `tinggi`. Satu-satunya
   metode yang mengalahkan Naive Bayes, dan biayanya praktis nol
2. **Review manusia tetap wajib.** Di ambang `tinggi`, kira-kira 1 dari 6
   saran yang ditulis masih salah
3. **Model lokal kalah dari baseline yang dilatih.** Untuk tugas sesempit ini,
   data latih yang relevan mengalahkan model umum yang kecil
4. **Ambang confidence lebih menentukan daripada pilihan model** untuk kualitas
   data yang masuk

Mode gagal yang ditemukan: Qwen 3B berhenti setelah satu jawaban per batch
(skema menjamin *bentuk*, bukan *kelengkapan*); Qwen 7B membuang keraguan ke
`nusantara`; kebab dan burrito sempat masuk `barat` sampai definisi slotnya
diperjelas di prompt. Detailnya di
[docs/PENGEMBANGAN-AI.md](docs/PENGEMBANGAN-AI.md#evaluasi-kategorisasi).

### Rekomendasi: contextual bandit

**Fitur.** `buildFeatureVector()` di `src/lib/ml/features.ts` mengubah satu
pasangan (pengguna, warung, momen) jadi vektor 26 angka. Fungsi yang sama
dipakai untuk pelatihan dan penyajian, jadi keduanya tidak bisa berbeda.

| Blok | Dimensi | Isi |
|---|---|---|
| Jarak | 2 | `−log(1+km)`, `1/(1+km)` |
| Harga | 2 | Tingkat harga, selisih dari kebiasaan pengguna |
| Masakan | 12 | One-hot slot |
| Waktu | 4 | Jam melingkar (sin/cos), akhir pekan, jam makan |
| Cuaca | 1 | +1 hujan, −1 tidak, 0 tidak tahu |
| Afinitas pengguna | 2 | Accept rate pengguna untuk kategori dan tingkat harga ini |
| Popularitas | 2 | Accept rate dan jumlah tayang warung |
| Bias | 1 | Konstanta |

Harga dan cuaca yang tidak diketahui bernilai netral 0.
Kebocoran dicegah secara struktural: `PriorTracker` memproses baris menurut
waktu, dan fitur sebuah baris hanya dihitung dari baris sebelumnya.

**Label.** `/api/spin` mencatat setiap penayangan, termasuk yang ditolak atau diabaikan:

| `action` | Artinya |
|---|---|
| `accepted` | "Jadi ke sini". Hanya ini yang dihitung reward 1 |
| `saved` | "Simpan buat nanti" |
| `respun` | Spin lagi selagi hasil ini masih di layar |
| `ignored` | Lewat 5 menit tanpa respons |

**Model.** Thompson Sampling di atas regresi linear Bayesian: `A ← A + xxᵀ`,
`b ← b + rx`, pilih `argmax θ̃ᵀx` dengan `θ̃ ~ N(θ̂, σ²A⁻¹)`. A⁻¹ diperbarui
lewat Sherman–Morrison, dan faktor Cholesky ikut disimpan di artefak, jadi
penyajian tidak melakukan dekomposisi apa pun.

**Hasil simulasi** (1.500 ronde, 40 pengguna sintetis, 60 warung; dicetak
ulang oleh `npm test`):

| Kebijakan | Accept | Regret | Cakupan katalog |
|---|---|---|---|
| *oracle (batas atas)* | *72,1%* | *0* | - |
| LinUCB | 65,7% | **70,6** | 57% |
| **Thompson Sampling** | 65,0% | 89,6 | **77%** |
| ε-greedy | 64,7% | 111,3 | 100% |
| Jarak terdekat | 55,9% | 266,1 | 37% |
| Acak seragam | 44,9% | 428,5 | 100% |

Thompson menurunkan cumulative regret **79% dibanding acak seragam**. LinUCB
unggul di regret, Thompson unggul di cakupan. Proyek ini memilih Thompson
karena aplikasi yang terus menyodorkan lima tempat yang sama akan ditinggal
pengguna, berapa pun accept rate-nya.

> **Simulasi tidak membuktikan sistem ini bekerja pada manusia.** Pengguna
> sintetis bersifat linear dan tidak pernah bosan. Angka di atas hanya
> menunjukkan model belajar *kalau dunianya sesuai asumsi.*

### Evaluasi off-policy

`npm run ml:evaluate` memperkirakan accept rate kebijakan baru seandainya ia
yang memilih pada penayangan yang sudah tercatat. Pengguna tidak melihat apa
pun selama evaluasi ini.

```
w     = π_baru(a|x) / p_lama(a|x)
IPS   = (1/n) Σ w·r
SNIPS = Σ w·r / Σ w
```

- Skrip membagi log **menurut waktu** (70/30). Pembagian acak membocorkan
  masa depan ke pelatihan
- SNIPS sebagai angka utama, dengan interval 95% bootstrap
- **Effective sample size** dicetak, dengan peringatan kalau di bawah 10% n
- **Bobot dibatasi di 100.** Pengguna bisa menyisipkan baris `spin_events`
  sendiri lewat anon key; tanpa batas, satu baris palsu bisa menentukan
  seluruh hasil

Karena itu `/api/spin` mencatat `policy_score` sejak hari pertama. Undian lama
berbobot harga, dan replay tanpa peluang itu mewarisi bias harganya.

### Penyajian di belakang flag

**Mati secara default.**

| Variabel | Default | Arti |
|---|---|---|
| `BANDIT_ROLLOUT` | `0` | Porsi pengguna yang dilayani bandit, 0–1 |
| `BANDIT_BUNDLE_PATH` | `ml/bandit.json` | Lokasi model |
| `BANDIT_ALLOW_SYNTHETIC` | - | `true` hanya untuk mencoba alurnya secara lokal |

- **Pembagian per pengguna, deterministik** (hash FNV-1a dari `user_id`)
- **Propensity yang jujur.** `policy.ts` menarik θ̃ 200 kali, menghitung
  frekuensi menang tiap kandidat, mencampurnya dengan ε = 0,1 seragam, lalu
  benar-benar mengundi dari distribusi itu. Jadi `policy_score` adalah peluang
  sebenarnya, dan tidak ada kandidat berpeluang nol
- **Bandit tidak bisa menggagalkan spin.** Kalau model hilang, rusak,
  sintetis, dilatih dari kurang dari 500 contoh, atau query riwayat gagal,
  `/api/spin` kembali ke undian berbobot dan menulis satu peringatan di log

### Status dan rencana AI

Seluruh pipeline sudah ada dan teruji. **Belum ada model yang dilatih dari
data nyata**, dan flag penyajiannya mati. Langkah berikutnya adalah
mengumpulkan data.

| Tahap | Isi | Status |
|---|---|---|
| 1. Bereskan data | Evaluasi kategorisasi, harga tak diketahui tidak ditebak, ingest dan kurasi Bandung | Sebagian besar selesai |
| 2. Kumpulkan data | Deploy, kumpulkan ~500 spin berlabel | Belum |
| 3. Nyalakan bandit | `ml:evaluate` → `ml:train` → `BANDIT_ROLLOUT=0.1` → pantau 2 minggu → 0,5 | Butuh tahap 2 |
| 4. Fitur AI berikutnya | Penjelasan rekomendasi, permintaan bahasa alami ("pengen yang berkuah, murah, deket"), pelatihan ulang terjadwal | Kandidat |

Rencana ini sengaja tidak memuat LLM yang menebak harga atau jam buka, atau LLM
yang memilih warung langsung.

---

## Tech stack

| Bagian | Pilihan |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), monolith |
| Database | Supabase Postgres + PostGIS, Row Level Security, `pg_cron` |
| Auth | Supabase, anonymous sign-in + magic link email |
| Styling | Tailwind CSS 4 |
| Huruf & ikon | Font sistem (`font-sans` Tailwind), lucide-react |
| Peta | Leaflet + react-leaflet, tile OpenStreetMap |
| Animasi | Framer Motion (dimuat setelah halaman siap) |
| Uji | Vitest, **394 tes** |
| ML | Bandit TypeScript sendiri (regresi linear Bayesian, Thompson Sampling, IPS/SNIPS) |
| LLM | Gemini, Ollama lokal, atau Claude, hanya untuk kurasi data lewat skrip |
| Data eksternal | OpenStreetMap (Overpass), Open-Meteo (opsional) |

Tidak ada layanan terpisah. Model rekomendasinya pun muat di dalam route
handler yang sudah ada.

---

## Menjalankan secara lokal

Butuh **Node 20+** dan satu project Supabase.

### 1. Pasang

```bash
git clone https://github.com/adnankurniawann/gacha-makan-ai.git
cd gacha-makan-ai
npm install
```

### 2. Environment

Buat `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>

# Opsional. Mencatat konteks cuaca lewat Open-Meteo; mati kalau tidak diisi.
# ENABLE_WEATHER_CONTEXT=true

# Opsional. Porsi pengguna yang dilayani bandit (0..1); mati kalau tidak diisi.
# Butuh ml/bandit.json yang dilatih dari data nyata.
# BANDIT_ROLLOUT=0.1

# Hanya untuk skrip kurasi LLM. Default-nya Ollama lokal yang tidak butuh key.
# GEMINI_API_KEY=<key>      # --provider=gemini
# ANTHROPIC_API_KEY=<key>   # --provider=claude
# OLLAMA_MODEL=qwen2.5:7b   # --provider=ollama
```

URL Supabase ditulis **tanpa** `/rest/v1/` di belakangnya.

**Jangan pernah menaruh `service_role` key di sini atau di mana pun.** Aplikasi
ini tidak memakainya, dan sebaiknya tetap begitu: key itu melewati seluruh
Row Level Security.

### 3. Database

Di Supabase SQL Editor, jalankan **satu per satu, berurutan**. Buka berkasnya,
salin isinya, lalu Run. Menempelkan nama berkasnya tidak menjalankan apa pun.

```
supabase/schema.sql
supabase/seed.sql
supabase/migrations/20260804000001_rls_hardening.sql
supabase/migrations/20260804000002_jam_buka_dan_kualitas_data.sql
supabase/migrations/20260804000003_spin_events_dan_favorit.sql
supabase/migrations/20260804000004_propensity_dan_metrik.sql
supabase/migrations/20260804000005_konteks_cuaca.sql
supabase/migrations/20260804000006_kandidat_spin.sql
supabase/migrations/20261026000001_riwayat_bandit.sql
supabase/migrations/20261027000001_harga_belum_diketahui.sql
supabase/migrations/20261027000002_cabut_akses_fungsi_sistem.sql
supabase/migrations/20261027000003_potong_saldo_atomik.sql
supabase/migrations/20261027000004_skor_kebersihan_belum_dinilai.sql
```

| Migrasi | Isi |
|---|---|
| `rls_hardening` | Cabut hak tulis klien; laporan kebersihan lewat fungsi `security definer` |
| `jam_buka_dan_kualitas_data` | Jam buka, `is_open_now()`, antrean kurasi |
| `spin_events_dan_favorit` | Log penayangan, label respons, favorit |
| `propensity_dan_metrik` | `policy_score`, view retensi dan metrik |
| `konteks_cuaca` | Kolom `is_raining` |
| `kandidat_spin` | Daftar kandidat per penayangan |
| `riwayat_bandit` | View riwayat pengguna untuk penyajian bandit |
| `harga_belum_diketahui` | Tempat tanpa harga ikut jadi kandidat spin |
| `cabut_akses_fungsi_sistem` | `mark_ignored_spins()` hanya untuk sistem |
| `potong_saldo_atomik` | Potong saldo dompet dalam satu `UPDATE` |
| `skor_kebersihan_belum_dinilai` | Skor `null` untuk tempat tanpa laporan |

Semuanya idempoten, jadi aman diulang kalau ragu sudah pernah dijalankan.

Cek semuanya masuk:

```sql
select
  to_regclass('public.opening_hours') is not null as fase_b,
  to_regclass('public.spin_events')   is not null as fase_d,
  to_regclass('public.spin_misses')   is not null as fase_e,
  exists(select 1 from information_schema.columns
         where table_name = 'spin_events' and column_name = 'candidate_ids') as ml_fase_3,
  to_regprocedure('public.deduct_wallet(integer)') is not null as potong_saldo;
```

Kelimanya harus `true`.

### 4. Dashboard Supabase

Dua hal yang **wajib**, dan keduanya tidak bisa diatur dari kode:

- **Authentication → Providers → Anonymous sign-ins: aktif.** Tanpa ini tidak
  ada `user_id`, jadi riwayat spin dan favorit **tidak akan pernah tercatat**.
  Ini penyebab paling umum halaman riwayat terlihat kosong terus
- **Database → Extensions → `pg_cron`**, lalu jadwalkan penanda spin
  terabaikan dari SQL Editor:

  ```sql
  select cron.schedule(
    'tandai-spin-terabaikan', '*/5 * * * *',
    $job$ select public.mark_ignored_spins(); $job$
  );
  ```

  Tanpa ini tidak ada yang rusak, karena `spin_events_labeled` tetap
  memperlakukan penayangan lewat 5 menit sebagai `ignored`. Tabelnya saja
  yang jadi tidak rapi

### 5. Buktikan RLS-nya benar

```bash
node scripts/verify-rls.mjs
```

Skrip ini memakai anon key yang sama dengan frontend, lalu **mencoba** operasi
terlarang. Percobaan tulisnya dirancang tidak merusak: DELETE dan INSERT
memakai UUID acak, UPDATE menulis ulang nilai yang sama persis.

Aplikasi yang masih jalan cuma membuktikan jalur yang diizinkan terbuka. Untuk
tahu jalur terlarang sudah tertutup, kamu harus mencobanya, dan skrip ini yang
mencobanya.

### 6. Jalankan

```bash
npm run dev
```

---

## Perintah

```bash
npm run dev                                     # server pengembangan
npm test                                        # 394 tes
npm run lint                                    # eslint
npm run build                                   # build produksi

node scripts/verify-rls.mjs                     # buktikan kebijakan RLS
node scripts/bundle-size.mjs                    # ukuran bundle per halaman
node scripts/ingest-osm.mjs --area=bandung      # tarik data dari OpenStreetMap
node scripts/csv-to-seed.mjs                    # ubah kurasi manual jadi SQL
```

Pipeline AI:

```bash
# Kurasi kategori → supabase/generated/kategori-llm.{sql,review.md}
npm run ml:categorize -- --dry-run                                  # lihat yang akan dikirim
npm run ml:categorize -- --provider=gemini --min-confidence=tinggi  # yang dipakai untuk Bandung

# Evaluasi kategorisasi di test set OSM → ml/eval/results.*.md
npm run ml:eval-categorize -- --provider=gemini
npm run ml:snapshot-osm                                             # perbarui snapshot (jarang)

# Bandit
npm run ml:evaluate                                                 # tanpa argumen: cetak kueri ekspor
npm run ml:evaluate -- --input=spins.csv --restaurants=restaurants.csv
npm run ml:train -- --input=spins.csv                               # → ml/bandit.json
npm run ml:synthesize                                               # log sintetis untuk mencoba alurnya
```

Mencoba seluruh alur bandit tanpa data nyata:

```bash
npm run ml:synthesize
npm run ml:evaluate -- --input=ml/data/synthetic-spins.json --restaurants=ml/data/synthetic-restaurants.json
npm run ml:train -- --input=ml/data/synthetic-spins.json --out=ml/data/synthetic-bandit.json
```

Model dari data sintetis otomatis ditandai dan **ditolak saat menyajikan**.

`bundle-size.mjs` dijalankan setelah `npm run build`. Next 16 dengan Turbopack
tidak lagi mencetak tabel "First Load JS", jadi angkanya dibaca dari tag
`<script>` di HTML hasil prerender.

---

## Struktur proyek

```
src/app/              Halaman dan route handler
  api/                spin, spin/action, report, favorites, restaurants, wallet/deduct
  spin/ blind/        Dua cara mendapatkan hasil
  map/ riwayat/       Peta dan riwayat
  dompet/             Budget makan bulanan
  hasil/[id]/         Halaman hasil yang bisa dibagikan, plus Open Graph image
  login/ account/     Masuk opsional
src/components/       UI per bagian (home, spin, map, location, auth, pwa, ui)
src/lib/
  supabase/           Klien, query, pencatatan peristiwa, sesi
  ml/                 Fitur, bandit, simulator, evaluasi, penyajian, kurasi LLM
  ml/eval/            Dataset OSM, Naive Bayes, metrik evaluasi kategorisasi
  location.ts         Preset area dan ingatan lokasi
  weather.ts          Konteks cuaca, tanpa pernah menunggu jaringan
  rate-limit.ts       Sliding window per IP
src/utils/            Logika murni: undian gacha, geo, format harga dan skor
supabase/             Skema dan migrasi
scripts/              Ingest, verifikasi, pengukuran, pipeline ML
ml/eval/              Snapshot OSM dan laporan evaluasi kategorisasi
docs/                 Dokumentasi pengembangan AI
data/                 Template kurasi manual
```

API:

| Route | Isi | Rate limit |
|---|---|---|
| `POST /api/spin` | Pilih satu warung, catat penayangan | 30 / menit |
| `POST /api/spin/action` | Catat respons atas penayangan | 60 / menit |
| `POST /api/report` | Laporan kebersihan Red Flag / Clean | 20 / jam |
| `POST`, `DELETE /api/favorites` | Simpan / hapus favorit | 60 / menit |
| `GET /api/restaurants` | Semua tempat dengan koordinat, untuk peta | - |
| `POST /api/wallet/deduct` | Potong saldo dompet, hanya bilangan bulat positif | - |

---

## Keamanan dan keputusan desain

**Klien tidak punya hak tulis ke tabel penting.** Anon key ikut terkirim di
bundle JavaScript, jadi anggap orang asing sudah melakukan apa pun yang bisa
dilakukan pemegangnya. Skor kebersihan hanya berubah lewat fungsi `security
definer`, dan pengguna tidak bisa memanggil fungsi sistem seperti
`mark_ignored_spins()`.

**Data yang tidak diketahui tetap `null`.** Itu berlaku untuk harga yang belum
dikurasi, skor kebersihan tanpa laporan, cuaca yang belum terbaca, dan jam buka
yang tidak bisa diurai. Tebakan, dari kode maupun dari LLM, membohongi filter
pengguna dan menanam fitur palsu ke data latih.

**Jam buka punya tiga keadaan:** `true`, `false`, dan `null` untuk belum
terdata. Kalau "belum tahu" dianggap tutup, katalog kosong. Kalau dianggap
buka, kamu bisa dikirim ke warung yang sudah tutup. Pencarian memakai
`is not false`.

**Ingest dan kurasi menghasilkan SQL untuk direview.** Deduplikasi berbasis
kemiripan nama bisa salah, dan LLM keliru kira-kira 1 dari 6 kali. Membaca
daftarnya dulu lebih murah daripada membereskan data yang sudah tercampur.

**`/api/spin` mencatat setiap penayangan beserta konteks saat itu,** termasuk
peluang kebijakan memilihnya dan seluruh kandidat. Log ini jadi data latih
model rekomendasi. Kolom yang terlewat saat penayangan tidak bisa ditambahkan
belakangan.

**Fungsi `deduct_wallet` memotong saldo dalam satu `UPDATE`.** Dua tab yang
menekan "Jadi ke sini" bersamaan tidak saling menimpa.

**Server membulatkan koordinat ke ~11 km** sebelum mengirimnya ke Open-Meteo,
jadi lokasi persis pengguna tidak sampai ke pihak ketiga.

---

## Menambah data restoran

Dua jalur, keduanya sah.

### Otomatis: OpenStreetMap

```bash
node scripts/ingest-osm.mjs --area=bandung      # atau jatinangor, ganesha
```

Skrip menulis `supabase/generated/<area>.sql` dan `.review.md`. **Baca berkas
review dulu.** Di situ tercatat baris mana yang dianggap duplikat dan
alasannya. Baris baru masuk dengan harga dan skor kebersihan `null`.

Setelah itu jalankan kurasi kategori supaya tempat berkategori "Restaurant"
polos dapat slot masakan (lihat
[Kurasi kategori dengan LLM](#kurasi-kategori-dengan-llm)).

### Manual: dari Google Maps

1. Isi `data/kurasi-restoran.csv`
2. `node scripts/csv-to-seed.mjs`
3. Review SQL-nya, lalu tempel ke SQL Editor

Validasinya menangkap **latitude dan longitude yang tertukar**, kesalahan
paling umum saat menyalin dari peta. Titik hasilnya jatuh di Samudra Hindia,
di luar radius siapa pun, jadi kamu tidak akan sadar tanpa validasi ini.

> **Lisensi:** dari Google Maps kamu boleh menyalin **fakta**: nama,
> koordinat, alamat, jam buka. **Jangan menyalin rating, teks ulasan, atau foto**;
> menyimpannya secara permanen melanggar ToS Google Maps Platform.

Tempat tanpa harga tetap muncul di spin sebagai "Harga belum diketahui", dengan
bobot undian terkecil, sampai seseorang mengisi harganya lewat kurasi.

---

## Metrik

Tidak ada panel admin; Supabase Studio sudah cukup. Kueri A/B per kebijakan,
cakupan katalog, kandidat kosong, dan latensi ada di
[docs/PENGEMBANGAN-AI.md](docs/PENGEMBANGAN-AI.md#metrik).

Satu angka yang paling menentukan sekarang:

```sql
select cohort_date, users, returned_d1,
       round(100.0 * returned_d1 / nullif(users, 0), 1) as d1_pct
from retention_by_cohort
order by cohort_date desc
limit 14;
```

**Kalau D1 di bawah 20%, jangan tambah fitur,** termasuk fitur AI. Cari tahu
dulu kenapa orang tidak kembali.

Mendeteksi kenaikan accept rate dari 20% ke 25% butuh sekitar **1.000+ spin
per kelompok.** Kalau datanya kurang, laporkan angkanya beserta interval
kepercayaan, misalnya "n=180, selisih +4,2 pp, CI 95% [−3,1; +11,5], tidak
signifikan".

---

## Status dan keterbatasan

Yang sudah jalan: pencarian radius dengan filter jam buka, laporan kebersihan
dengan cooldown, sesi anonim, PWA, pencatatan umpan balik, kartu hasil yang
bisa dibagikan, riwayat, favorit, dompet, katalog Bandung dari OSM, dan seluruh
pipeline AI (kurasi, evaluasi, pelatihan, penyajian) di belakang flag.

Yang jujur perlu disebut:

- **Sebagian besar tempat belum punya harga, jam buka, dan laporan
  kebersihan.** Aplikasi menampilkannya dengan label "belum diketahui" atau
  "belum ada laporan"
- **Bandit belum pernah dilatih dari data nyata.** Semua angka model di atas
  berasal dari simulasi
- **Slot `sunda` hampir tidak terukur** di evaluasi kategorisasi: hanya 7 nama
  di test set, padahal ini slot terpenting untuk Bandung
- **Marker peta untuk tempat tanpa laporan masih hijau**, karena status peta
  hanya punya dua nilai (aman / red flag)
- **Rate limit disimpan di memori proses**, jadi di serverless hitungannya per
  instance. Ia menahan skrip iseng, tapi tidak menahan penyerang serius
- **Cooldown laporan per IP bisa diakali** karena `x-forwarded-for` bisa
  dipalsukan. Yang benar-benar melindungi skor adalah dicabutnya hak UPDATE
- **Performa baru diukur lewat ukuran bundle**, belum lewat Lighthouse di
  perangkat sungguhan
- **Belum ada backup otomatis**, karena Supabase free tier tidak menyediakannya.
  Ambil dump manual sebelum data spin mulai berarti
- **Belum di-deploy**

### Sebelum menyebar link

Kolom yang tidak tercatat sekarang hilang selamanya. Kamu tidak bisa
menambahkan kolom ke peristiwa yang sudah terjadi.

- [ ] Semua migrasi dijalankan
- [ ] Anonymous sign-ins aktif. Tanpa ini **nol baris** tercatat
- [ ] `pg_cron` aktif dan `mark_ignored_spins()` terjadwal
- [ ] `select count(*) from spin_events` naik setelah kamu spin sendiri
- [ ] `policy_score` terisi, bukan null

---

## Asal proyek

Dikembangkan dari proyek Kelompok 7 PRD: Rafi Pradipta Andira Sulistyo,
M. Adnan Kurniawan, Kairenzo Vemil, Sulthan Dhiyazka, dan Muhammad Reffah.
Repo ini melanjutkannya secara mandiri, terutama bagian AI dan machine
learning: kurasi kategori dengan LLM, evaluasi off-policy, dan penyajian
bandit.

---

## Berkontribusi

Kerjakan di branch, buka PR ke `main`. Konvensi commit: `tipe: deskripsi`
(`feat`, `fix`, `perf`, `style`, `docs`).

Sebelum membuka PR:

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

Beberapa hal yang mudah tanpa sadar dirusak:

- **Pakai `m.*`, bukan `motion.*`.** `MotionProvider` memuat mesin animasi
  belakangan, dan `motion.*` menariknya kembali ke bundle awal
- **`SessionBootstrap` harus mengimpor klien Supabase secara dinamis.** Impor
  statis di root layout menambah ~60 kB ke setiap halaman
- **Jangan mengubah urutan `FEATURE_NAMES`** tanpa melatih ulang model; artefak
  yang susunannya tidak cocok akan ditolak saat dimuat
- **Ganti `SPIN_POLICY` atau `BANDIT_POLICY`** setiap kali aturan pemilihan
  berubah, supaya baris dari perilaku lama dan baru tetap bisa dipisahkan
- **Ubah prompt kurasi di split dev, ukur ulang, baru lihat test.** Mengubah
  dua definisi slot pernah menggeser 119 dari 516 keputusan kurasi Bandung
- **Naikkan `VERSION` di `public/sw.js`** setiap kali berkas itu diubah. Nomor
  itu yang memicu pembersihan cache lama

Jangan commit `.env.local`. Kalau sebuah key pernah ter-commit, rotasi key itu
di Supabase Dashboard → Settings → API Keys. Riwayat git tetap menyimpannya
walau berkasnya sudah kamu hapus.
