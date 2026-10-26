# Roadmap ML — status

Rencananya mengubah seleksi acak berbobot jadi contextual bandit dengan
Thompson Sampling. Berkas ini mencatat apa yang sudah siap dan apa yang belum,
supaya tidak ada yang mengerjakan ulang instrumentasi yang sebenarnya sudah
ada.

## Fase 0 — instrumentasi: **selesai**

Sebagian besar sudah terpenuhi lebih dulu oleh Fase D dan E spec produksi.

| Kolom di roadmap | Status |
|---|---|
| `user_id`, `session_id`, `restaurant_id` | ✅ Fase D |
| `shown_at`, `user_lat`, `user_lng`, `distance_km` | ✅ Fase D |
| `hour_local`, `day_of_week`, `is_weekend` | ✅ Fase D |
| `policy` | ✅ Fase D — diisi `weighted_budget_v1` |
| `candidate_n` | ✅ Fase D |
| `action`, `acted_at` | ✅ Fase D |
| `policy_score` | ✅ Fase E |
| `is_raining` | ✅ ML Fase 0 |

Ditambah yang tidak ada di roadmap tapi ternyata perlu: `latency_ms` untuk
metrik p95, dan tabel `spin_misses` untuk spin yang berakhir tanpa kandidat —
kegagalan yang sebelumnya tidak meninggalkan jejak apa pun.

Keempat aturan Fase 0 juga sudah dipaksakan, bukan sekadar disarankan:
konteks dibekukan saat penayangan, `policy` wajib di tiap baris, `candidate_n`
tercatat, dan `ignored` ditulis sebagai label lewat `mark_ignored_spins()`.

README publik dan deploy: README sudah diganti di Fase E. Deploy ke Vercel
belum — lihat bagian terakhir.

## Koreksi penting terhadap roadmap

Roadmap menulis, sebagai keunggulan utamanya:

> Aplikasi kamu sekarang memilih secara acak seragam. Itu kebetulan adalah
> kebijakan pengumpulan data yang ideal.

**Itu tidak berlaku untuk kode ini.** `calculateSpinWeights` memberi bobot
`max(1, budget - price_tier)`, jadi dengan budget Rp20.000 sebuah tempat
Rp5.000 punya peluang 75% dan tempat Rp15.000 punya 25%.

Konsekuensinya: replay evaluation polos — "kalau pilihan kebijakan baru sama
dengan yang tercatat, terima barisnya" — **tidak tak bias di sini.** Ia
mewarisi bias harga dari kebijakan lama.

Yang harus dipakai nanti adalah inverse propensity scoring, membagi tiap
reward dengan `policy_score` baris tersebut:

```
estimasi = (1/n) * Σ  [ 1{π_baru(x) = a_tercatat} * r / policy_score ]
```

Karena itu `policy_score` ada, dan karena itu ia ditambahkan **sebelum**
trafik datang di Fase E, bukan saat model dikerjakan. Konteks yang tidak
dicatat saat penayangan tidak bisa ditambahkan belakangan.

## Konteks cuaca

**Mati secara default.** Nyalakan dengan `ENABLE_WEATHER_CONTEXT=true`.

Fitur ini memanggil Open-Meteo, layanan pihak ketiga, jadi keputusannya ada di
tangan yang men-deploy — bukan menyala diam-diam saat merge.

Aturan pentingnya: **jalur spin tidak pernah menunggu jaringan.** Nilainya
dibaca dari cache dalam memori (TTL 10 menit); kalau dingin, tercatat `null`
dan penyegaran dilepas di latar untuk spin berikutnya. Beberapa spin pertama
pada instance baru akan `null`, dan itu jauh lebih baik daripada menaikkan p95
demi satu kolom.

Koordinat dibulatkan ke ~11 km sebelum dikirim keluar. Dua alasan: lokasi
persis pengguna tidak pernah sampai ke pihak ketiga, dan seluruh Jatinangor
jatuh ke kunci cache yang sama sehingga hampir semua permintaan mengenai cache
hangat.

`null` berarti **tidak tahu**, bukan "tidak hujan". Bedanya harus dipertahankan
sampai ke database — mengisi `false` saat sebenarnya tidak tahu berarti menanam
fitur palsu ke dalam data latih.

## Fase 1 — fungsi fitur: **selesai**

`src/lib/ml/features.ts` — `buildFeatureVector(input) → number[26]`. Murni:
tidak menyentuh jaringan, tidak membaca jam, tidak membaca database. Semua
yang berubah masuk lewat parameter.

| Blok | Dim | Indeks |
|---|---|---|
| Jarak | 2 | 0–1 |
| Harga | 2 | 2–3 |
| Masakan (one-hot) | 12 | 4–15 |
| Waktu | 4 | 16–19 |
| Cuaca | 1 | 20 |
| Afinitas user | 2 | 21–22 |
| Popularitas | 2 | 23–24 |
| Bias | 1 | 25 |

`FEATURE_BLOCKS` dan `ablateBlock()` disiapkan untuk ablasi di Fase 2.

### Kebocoran dicegah secara struktural

`buildTrainingSet()` di `src/lib/ml/training.ts` memproses baris berurutan
menurut `shown_at`, menghitung fitur dari pencacah yang isinya **hanya baris
sebelumnya**, lalu memperbarui pencacah **sesudah** fiturnya dibuat. Tidak ada
jalan bagi hasil sebuah baris untuk memengaruhi fiturnya sendiri.

Itu ditulis di TypeScript, bukan sebagai SQL window function, dengan sengaja:
fitur masakan bergantung pada `toCuisineSlot`, dan menulis ulang pemetaan itu
di SQL berarti cepat atau lambat versi SQL dan versi TypeScript berbeda. Vektor
saat pelatihan tidak akan sama dengan vektor saat penyajian untuk peristiwa
yang sama, dan bug seperti itu tidak muncul di test mana pun sampai modelnya
sudah dipakai orang.

### Keputusan yang perlu diketahui sebelum menyentuh berkas ini

**Dua kosakata kategori disatukan.** Data seed memakai istilah Google Maps
berbahasa Inggris ("Chicken restaurant"), ingest OSM menghasilkan istilah
Indonesia ("Ayam"). Keduanya jatuh ke slot yang sama. Daftar slotnya tetap dan
pendek — one-hot yang tumbuh mengikuti isi database akan mengubah panjang
vektor setiap ada kategori baru, dan model yang sudah dilatih langsung tidak
cocok lagi.

**"Restaurant" polos adalah nilai paling umum di data seed, dan ia jatuh ke
`lainnya`.** Selama itu belum dikurasi, blok masakan praktis tidak membawa
informasi untuk sebagian besar tempat. Itu masalah kualitas data (Fase B),
bukan masalah model — dan ablasi di Fase 2 akan menunjukkannya.

**Afinitas dan popularitas dihaluskan lalu dipusatkan pada nol.** Rasio 1/1
dan 40/50 bukan bukti yang sama kuatnya; tanpa penghalusan, restoran yang baru
sekali tayang dan kebetulan diterima akan terlihat sempurna dan langsung
mendominasi. Dipusatkan supaya "belum ada riwayat" berarti nol — tidak
mendorong ke arah mana pun.

**Nilai yang tidak diketahui tetap netral, bukan ditebak.** Harga yang belum
dikurasi memberi 0, bukan tingkat 2. Cuaca memakai +1/−1/0 supaya "tidak tahu"
tidak bisa tertukar dengan "tidak hujan".

## Fase 2 — simulator dan baseline: **selesai**

`src/lib/ml/linalg.ts`, `bandit.ts`, `simulator.ts`. Model: Thompson Sampling
di atas regresi linear Bayesian, `A ← A + xxᵀ`, `b ← b + rx`, memilih
`argmax θ̃ᵀxᵢ` dengan `θ̃ ~ N(θ̂, σ²A⁻¹)`.

A⁻¹ disimpan langsung dan diperbarui lewat Sherman–Morrison — O(d²) per ronde
alih-alih O(d³) kalau A dibalik ulang tiap kali.

### Hasil

1.500 ronde, 40 pengguna, 60 restoran, benih 20260804. Jalankan ulang dengan
`npm test`; angkanya dicetak dari test supaya tidak pernah basi.

| Kebijakan | Accept | Regret | Coverage |
|---|---|---|---|
| *oracle (batas atas)* | *72,1%* | *0* | — |
| LinUCB (α=0,5) | 65,7% | **70,6** | 57% |
| Thompson Sampling | 65,0% | 89,6 | **77%** |
| ε-greedy (ε=0,1) | 64,7% | 111,3 | 100% |
| Jarak terdekat | 55,9% | 266,1 | 37% |
| Uniform random | 44,9% | 428,5 | 100% |

Thompson menurunkan cumulative regret **79% dibanding acak seragam** — yaitu
kebijakan yang sekarang benar-benar dipakai aplikasi.

### Yang tidak sesuai dugaan, dan tidak disembunyikan

**LinUCB mengalahkan Thompson pada regret** (70,6 vs 89,6). Thompson unggul di
cakupan katalog (77% vs 57%), dan untuk produk ini cakupan bukan hiasan:
sistem yang cuma merekomendasikan segelintir tempat teratas gagal sebagai
produk walau accept rate-nya tinggi.

Jadi pilihannya bukan "yang skornya paling bagus" melainkan trade-off yang
harus disebut apa adanya. Kalau nanti hanya regret yang dikejar, LinUCB
kandidat yang lebih baik.

**Jarak terdekat menutup katalog paling sempit** (37%) — baseline non-ML yang
lumayan kuat pada accept rate, tapi menampilkan tempat yang itu-itu saja.

### Ablasi

Ablasi membutakan **kebijakannya saja**; hadiah tetap dihitung dari fitur
penuh. Kalau lingkungannya ikut dibutakan, oracle-nya ikut bergeser dan angka
regret dari dua ablasi tidak lagi sebanding — pada percobaan pertama, membuang
satu blok bahkan terlihat *menguntungkan*, yang jelas tidak masuk akal.

`ablateBlock(x, "jarak")` dan seterusnya.

### Keputusan yang menentukan seluruh hasilnya

**`θ*_u = θ_bersama + deviasi kecil`, bukan θ* acak bebas per pengguna.**

Model ini belajar SATU θ yang dibagi ke semua pengguna, dan konteksnya cuma
punya dua dimensi afinitas pengguna. Kalau tiap pengguna diberi θ* yang
sepenuhnya bebas, tidak ada θ tunggal yang bisa mewakili mereka — dan pada
percobaan pertama memang begitu: Thompson kalah dari "ambil yang terdekat".
Yang terukur di situ bukan mutu modelnya, melainkan ketidakcocokan antara
model dan lingkungan karangan kita sendiri.

**σ = 0,3, bukan 1.** Dengan 26 dimensi dan hadiah biner, posterior yang lebar
membuat θ̃ melompat terlalu jauh tiap ronde dan Thompson berubah jadi
hampir-acak — kalah bahkan dari ε-greedy. Ini parameter pertama yang harus
dicurigai kalau hasilnya mengecewakan.

**Sepertiga katalog sintetis sengaja tanpa kategori berarti,** meniru data seed
di mana "Restaurant" polos adalah nilai paling umum. Simulasi dengan katalog
yang lebih rapi dari kenyataan akan melebih-lebihkan manfaat modelnya.

### Batasan — baca sebelum mengutip angka mana pun

Hasil simulasi **bukan bukti sistem bekerja pada manusia.**

- Pengguna sintetis di sini **linear dan stasioner**. Preferensinya tidak
  berubah, tidak bosan, dan tidak dipengaruhi teman di grup chat
- `P(accept) = sigmoid(θ*ᵀx)` mengasumsikan hadiahnya benar-benar fungsi dari
  fitur yang kita punya. Kalau yang menentukan sebenarnya sesuatu di luar
  vektor — warungnya sedang ramai, temannya mengajak ke tempat lain — model
  tidak akan pernah menemukannya, dan simulasi ini tidak akan menunjukkannya
- Batas atas oracle bergeser ~3 poin persen antar kebijakan, karena fitur
  popularitas bergantung pada apa yang pernah ditayangkan. Kecil, tapi bukan nol

Angka di atas hanya bukti bahwa modelnya belajar **kalau dunianya seperti yang
diasumsikan**. Buktinya pada manusia baru datang di Fase 4.

## Fase 3 — serving tanpa layanan Python: **selesai**

`src/lib/ml/model.ts`. Inferensi cuma satu perkalian matriks-vektor 26×26 —
tidak butuh Python, tidak butuh FastAPI, tidak butuh container tambahan, tidak
butuh cold start serverless kedua. Arsitekturnya tetap monolith Next.js.

Terukur **di bawah 0,01 ms per pemilihan** untuk 20 kandidat, dan ada tes yang
gagal kalau ia melewati 1 ms.

### Artefak model

JSON berisi `θ̂`, faktor Cholesky dari `σ²A⁻¹`, hiperparameter, jumlah contoh,
dan **daftar nama fitur menurut urutannya saat dilatih**.

Nama fitur itu bukan hiasan. Kalau seseorang menyisipkan satu blok fitur di
tengah, seluruh bobot bergeser satu posisi — modelnya tetap "jalan" dan
rekomendasinya jadi omong kosong tanpa satu pun error. `parseModelArtifact`
menolak memuat artefak yang susunannya tidak cocok, jadi kegagalannya terjadi
saat memuat, bukan saat merekomendasikan.

Cholesky dihitung saat pelatihan dan ikut disimpan. Penyajian tidak melakukan
dekomposisi apa pun; yang tersisa saat permintaan datang hanyalah `θ̃ = θ̂ + Lz`
lalu argmax.

### Pelatihannya TypeScript, bukan Python

Roadmap menyarankan Python. Untuk proyek ini itu justru berbahaya: fitur
dibangun oleh `buildFeatureVector`, dan menulis ulangnya di Python berarti dua
implementasi yang cepat atau lambat berbeda. Vektor saat pelatihan tidak akan
sama dengan vektor saat penyajian — alasan yang sama seperti kenapa ekstraksi
data latih tidak ditulis sebagai SQL window function di Fase 1.

Satu bahasa, satu fungsi fitur, satu perilaku.

### Arm set sekarang dicatat

Migrasi `20260804000006_kandidat_spin.sql` menambah `candidate_ids` dan
`candidate_distances_m` ke `spin_events`.

Ini prasyarat keras Fase 4. Evaluasi replay bertanya: "seandainya kebijakan
baru memilih pada konteks yang sama, apakah pilihannya sama dengan yang
tercatat?" Pertanyaan itu tidak bisa dijawab kalau yang tersimpan cuma satu
restoran yang menang. Seperti `policy_score`, kolom ini murah dibuat sekarang
dan mustahil dibuat nanti.

### Shadow scoring tetap offline

Menghitung fitur seluruh kandidat saat penayangan butuh statistik historis
per kandidat — satu round trip database tambahan di jalur yang p95-nya baru
saja mulai kita ukur, untuk informasi yang sama persis bisa didapat
belakangan dari `candidate_ids`. Jadi "shadow mode" di proyek ini adalah
`evaluate-bandit`: model menilai setiap kandidat yang pernah tersedia, tanpa
satu pun hasilnya ditayangkan.

Satu keterbatasan yang harus disebut: kategori dan harga kandidat
direkonstruksi dari katalog saat analisis, bukan dibekukan per kandidat. Untuk
dua kolom yang jarang dikurasi itu galatnya kecil dan bisa diperkirakan —
berbeda dari waktu dan cuaca, yang berubah terus dan karena itu memang
dibekukan.

## Kurasi kategori dengan LLM: **alat selesai, belum dijalankan**

`scripts/categorize-llm.ts` (`npm run ml:categorize`). Mengirim nama tiap
tempat yang sekarang jatuh ke `lainnya` ke Claude, dalam batch 40, dengan
structured outputs yang membatasi jawaban ke 12 slot yang ada.

Ini menyerang masalah yang disebut di Fase 1: selama "Restaurant" polos
mendominasi, 12 dari 26 dimensi fitur praktis kosong. Menebak bahwa "Ayam
Crisbar" itu warung ayam adalah pekerjaan bahasa, bukan statistik.

Bentuknya sama dengan ingest OSM — SQL untuk direview, tidak pernah menulis
langsung:

- **Yang tidak yakin tidak ditulis.** Slot `lainnya` dan confidence di bawah
  ambang (default `sedang`) hanya muncul di berkas review
- **Kurasi manusia selalu menang.** Tiap UPDATE menyertakan kategori lamanya
  di WHERE; baris yang sudah diubah tangan di antara saat skrip jalan dan saat
  SQL ditempel tidak tertimpa
- **Kategori yang sudah jelas tidak disentuh.** Hanya baris yang sekarang
  jatuh ke `lainnya` yang dikirim
- **Label yang ditulis dikunci tes** supaya `toCuisineSlot(label)` selalu
  kembali ke slot yang dimaksud. Label yang jatuh ke slot lain akan diam-diam
  merusak fitur

Katalog dibaca dengan anon key, karena memang publik. Tidak ada service_role.

## Fase 4 — evaluasi dan penyajian: **alat selesai, menunggu data**

### Pipeline

```bash
npm run ml:train -- --print-sql            # kueri ekspor untuk SQL Editor
npm run ml:evaluate -- --input=spins.csv --restaurants=restaurants.csv
npm run ml:train -- --input=spins.csv      # menulis ml/bandit.json
```

Skrip membaca berkas ekspor, bukan database. RLS membuat anon key hanya
melihat baris sendiri, dan pelatihan dari berkas yang disimpan bisa diulang
persis.

**Kueri ekspornya tidak memakai `spin_events_labeled` untuk kolom data.** View
itu dibuat dengan `e.*` di migrasi 3, sebelum `policy_score`, `is_raining`, dan
`candidate_ids` ada — Postgres membekukan daftar kolom `*` saat view dibuat,
jadi kolom-kolom itu tidak ada di sana. Labelnya tetap diambil dari view itu
supaya aturan "diabaikan setelah 5 menit" didefinisikan di satu tempat.

### Evaluasi off-policy

`src/lib/ml/evaluation.ts`. Log dibagi menurut **waktu** (default 70/30):
model dilatih pada bagian awal, dinilai pada sisanya. Fitur tiap kandidat
dihitung oleh `PriorTracker` yang sama dengan pelatihan dan penyajian, dari
riwayat sebelum penayangan itu saja.

Estimatornya SNIPS sebagai angka utama, IPS di sampingnya, plus interval 95%
dari bootstrap dan effective sample size. Tesnya membangun dunia dengan
jawaban yang diketahui — kebijakan pengumpul yang hanya 25% memilih warung
yang bagus — dan memastikan estimator mengembalikan nilai sebenarnya (0,8),
bukan accept rate yang tercatat (0,35).

**ESS adalah angka yang paling sering diabaikan.** Kebijakan pengumpul kita
berbobot harga, jadi kandidat mahal punya `policy_score` kecil dan bobot IPS
besar. Pada data sintetis 3.000 spin, ESS untuk Thompson cuma ~11 dari 900
baris: hasilnya ditentukan segelintir penayangan. Skrip mencetak peringatan
kalau ESS di bawah 10% n.

### Propensity untuk baris bandit

`loadModel().select()` mengambil argmax dari satu tarikan θ̃, dan peluang
sebuah kandidat menang di bawah aturan itu tidak punya bentuk tertutup.
Tanpa peluang itu, log dari bandit tidak bisa dipakai untuk evaluasi
berikutnya — kesalahan yang sama dengan yang hampir terjadi pada
`weighted_budget_v1`.

`src/lib/ml/policy.ts` menarik θ̃ 200 kali, menghitung frekuensi menang tiap
kandidat, mencampurnya dengan ε=0,1 seragam, lalu **mengundi dari distribusi
itu**. Karena pengundiannya benar-benar dilakukan dari distribusi yang
dicatat, `policy_score` adalah peluang sebenarnya. Campuran ε menjamin tidak
ada kandidat berpeluang nol — yang akan membuat bobot IPS tak terhingga.

### Penyajian di belakang flag

**Mati secara default.** Tiga environment variable:

| Variabel | Default | Arti |
|---|---|---|
| `BANDIT_ROLLOUT` | `0` | Porsi pengguna yang dilayani bandit, 0–1 |
| `BANDIT_BUNDLE_PATH` | `ml/bandit.json` | Lokasi bundle |
| `BANDIT_ALLOW_SYNTHETIC` | — | `true` hanya untuk mencoba alurnya secara lokal |

- **Pembagian per pengguna, deterministik** (hash FNV-1a dari `user_id`).
  Pengguna yang berpindah kelompok membuat perbandingan A/B mengukur campuran
- **Tidak pernah membuat spin gagal.** Bundle hilang, rusak, sintetis, kurang
  dari 500 contoh, query riwayat gagal — semuanya kembali ke
  `weighted_budget_v1` dengan satu peringatan di log
- **Baris bandit tercatat sebagai `thompson_v1`**, jadi kedua kelompok bisa
  dibandingkan langsung lewat `spin_events.policy`
- **Satu round trip tambahan untuk kelompok perlakuan**, dan dijalankan
  bersamaan dengan query kandidat. Kelompok kontrol tidak menyentuh jaringan
  sama sekali

Popularitas restoran tidak bisa dihitung di route handler tanpa service_role,
jadi ia dibekukan di bundle saat pelatihan (`snapshot`) dan basi sampai
pelatihan berikutnya. Afinitas pengguna dibaca segar dari riwayatnya sendiri
lewat view `spin_history_for_bandit` (migrasi `20261026000001`), yang dibatasi
RLS lewat `security_invoker`.

`next.config.ts` menambahkan `ml/*.json` ke trace `/api/spin`. Bundle dibaca
dengan `fs`, jadi tanpa itu berkasnya tidak ikut ter-deploy dan bandit
diam-diam tidak pernah menyala.

### Data sintetis untuk mencoba alurnya

```bash
npm run ml:synthesize
npm run ml:evaluate -- --input=ml/data/synthetic-spins.json \
    --restaurants=ml/data/synthetic-restaurants.json
```

Kebijakan pengumpulnya diberi nama `synthetic_weighted_budget`, dan nama itu
yang membuat bundle hasilnya otomatis ditandai sintetis dan **ditolak saat
menyajikan**. Angka dari sini membuktikan pipeline-nya jalan, bukan bahwa
modelnya bekerja pada manusia.

## Berikutnya

1. Jalankan kurasi kategori, review, tempel SQL-nya
2. Deploy, kumpulkan **~500 spin berlabel**. Sebelum itu interval kepercayaan
   apa pun akan melewati nol
3. `ml:evaluate`. Kalau batas bawah interval SNIPS Thompson di atas accept rate
   kebijakan sekarang, latih bundle, commit `ml/bandit.json`, nyalakan
   `BANDIT_ROLLOUT=0.1`
4. Bandingkan kedua kelompok di `spin_events` per `policy`. Laporkan apa
   adanya — termasuk kalau tidak signifikan. Lihat bagian akhir `METRIK.md`

## Yang belum: deploy

Aplikasinya belum di-deploy. Untuk Vercel yang dibutuhkan hanya dua environment
variable — `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` —
plus `ENABLE_WEATHER_CONTEXT` kalau konteks cuaca mau dipakai.

Jangan pernah menaruh `service_role` key di sana. Aplikasi ini tidak
memakainya, dan sebaiknya tetap begitu.
