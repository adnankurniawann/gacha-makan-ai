# Pengembangan versi AI

Dokumen ini mencatat bagian AI dan machine learning Gacha Makan: apa yang sudah
dibangun, keputusan di baliknya, cara menjalankannya, dan apa yang dikerjakan
berikutnya. Tujuannya supaya tidak ada yang mengerjakan ulang hal yang sudah
ada, dan tidak ada yang mengutip angka tanpa tahu batasannya.

**Status singkat:** seluruh pipeline sudah ada dan teruji, tapi **belum ada
model yang dilatih dari data nyata** dan flag penyajiannya mati. Langkah
berikutnya bukan menulis kode, melainkan mengumpulkan data — lihat
[Rencana pengembangan](#rencana-pengembangan).

---

## Daftar isi

- [Gambaran besar](#gambaran-besar)
- [Peta berkas](#peta-berkas)
- [Data dan instrumentasi](#data-dan-instrumentasi)
- [Fungsi fitur](#fungsi-fitur)
- [Kurasi kategori dengan LLM](#kurasi-kategori-dengan-llm)
- [Evaluasi kategorisasi](#evaluasi-kategorisasi)
- [Model: Thompson Sampling](#model-thompson-sampling)
- [Evaluasi off-policy](#evaluasi-off-policy)
- [Penyajian di belakang flag](#penyajian-di-belakang-flag)
- [Cara menjalankan](#cara-menjalankan)
- [Metrik](#metrik)
- [Rencana pengembangan](#rencana-pengembangan)
- [Aturan yang tidak boleh dilanggar](#aturan-yang-tidak-boleh-dilanggar)

---

## Gambaran besar

Aplikasi aslinya memilih warung secara acak berbobot harga
(`weighted_budget_v1`). Versi AI menggantinya dengan **contextual bandit**:
model yang belajar dari respons pengguna — diterima, disimpan, di-spin ulang,
atau diabaikan — warung mana yang cocok untuk siapa, kapan, dan dalam kondisi
apa.

Ada dua jenis AI di sini, dengan peran yang sengaja dipisah:

| | Tugas | Kenapa jenis ini |
|---|---|---|
| **LLM (Ollama lokal, Gemini, atau Claude)** | Membereskan data: menebak kategori masakan dari nama warung | Masalah bahasa. "Ayam Crisbar" itu warung ayam — tidak butuh statistik |
| **Bandit (Thompson Sampling)** | Memilih warung yang ditayangkan | Masalah keputusan berulang dengan umpan balik. Harus bisa dievaluasi dan diaudit |

LLM tidak pernah memilih warung. Alasannya bukan soal kemampuan: pilihan yang
dibuat LLM tidak punya peluang yang bisa dicatat, dan tanpa peluang itu log-nya
tidak bisa dipakai untuk evaluasi yang jujur.

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

Arsitekturnya tetap monolith Next.js. Tidak ada Python, tidak ada FastAPI,
tidak ada container tambahan: inferensinya cuma perkalian matriks-vektor 26×26.

---

## Peta berkas

| Berkas | Isi |
|---|---|
| `src/lib/ml/taxonomy.ts` | 12 slot masakan, pemetaan kategori → slot, label untuk kurasi |
| `src/lib/ml/features.ts` | `buildFeatureVector` → vektor 26 dimensi |
| `src/lib/ml/training.ts` | `PriorTracker` dan `buildTrainingSet` — fitur tanpa kebocoran |
| `src/lib/ml/linalg.ts`, `bandit.ts` | Regresi linear Bayesian, kebijakan pembanding |
| `src/lib/ml/simulator.ts` | Pengguna sintetis untuk membandingkan kebijakan |
| `src/lib/ml/model.ts` | Artefak model, validasi saat memuat |
| `src/lib/ml/bundle.ts` | Artefak + snapshot statistik, syarat boleh menyajikan |
| `src/lib/ml/policy.ts` | Thompson dengan propensity yang bisa dicatat, pembagian kelompok A/B |
| `src/lib/ml/evaluation.ts` | IPS, SNIPS, interval bootstrap, ESS |
| `src/lib/ml/serve.ts` | Penyajian di `/api/spin` |
| `src/lib/ml/categorize.ts` | Prompt, validasi, dan pembuatan SQL untuk kurasi LLM |
| `scripts/categorize-llm.ts` | Memanggil LLM untuk kurasi kategori → SQL untuk direview |
| `scripts/lib/llm-providers.ts` | Provider Ollama, Gemini, dan Claude, dipakai kurasi dan evaluasi |
| `src/lib/ml/eval/dataset.ts` | Pedoman label OSM, dedup, split, sampel berimbang |
| `src/lib/ml/eval/naive-bayes.ts` | Baseline Naive Bayes n-gram huruf |
| `src/lib/ml/eval/metrics.ts` | Akurasi, macro-F1, confusion, bootstrap, McNemar, titik operasi |
| `scripts/snapshot-osm-cuisine.ts` | Membekukan nama + `cuisine` OSM se-Indonesia ke `ml/eval/` |
| `scripts/eval-categorize.ts` | Harness evaluasi; laporan di `ml/eval/results.test.md` |
| `scripts/train-bandit.ts`, `evaluate-bandit.ts` | Pelatihan dan evaluasi dari ekspor |
| `scripts/synthesize-spins.ts` | Log sintetis untuk mencoba alurnya |
| `scripts/lib/spin-export.ts` | Pembaca ekspor CSV/JSON dan kueri ekspornya |
| `supabase/migrations/20261026000001_riwayat_bandit.sql` | View riwayat pengguna untuk penyajian |

Semua bagian murni di `src/lib/ml/` punya tesnya sendiri di sebelahnya.

---

## Data dan instrumentasi

Setiap penayangan hasil spin dicatat di `spin_events`, **bukan hanya yang
diterima**. Tidak merespons adalah sinyal, dan jumlahnya paling banyak.

| Kolom | Gunanya |
|---|---|
| `hour_local`, `day_of_week`, `is_weekend`, `distance_km` | Konteks, dibekukan saat penayangan |
| `is_raining` | Cuaca; `null` berarti **tidak tahu**, bukan "tidak hujan" |
| `policy` | Kebijakan yang memilih: `weighted_budget_v1`, `weighted_budget_v2`, atau `thompson_v1` |
| `policy_score` | Peluang kebijakan itu memilih warung ini — wajib untuk evaluasi |
| `candidate_ids`, `candidate_distances_m` | Seluruh kandidat saat itu, bukan cuma pemenangnya |
| `action`, `acted_at` | Label: `accepted`, `saved`, `respun`, atau `ignored` |
| `latency_ms` | Untuk metrik p95 |

Spin yang berakhir tanpa kandidat dicatat terpisah di `spin_misses`.

### Label

| `action` | Artinya |
|---|---|
| `accepted` | Menekan "Jadi ke sini" — satu-satunya yang dihitung reward 1 |
| `saved` | Menekan "Simpan buat nanti" |
| `respun` | Spin lagi selagi hasil ini masih di layar |
| `ignored` | Lewat 5 menit tanpa respons, ditulis oleh `mark_ignored_spins()` |
| `null` | Jendela responsnya belum habis — **belum boleh dihitung apa pun** |

Respons pertama yang menang: `record_spin_action()` hanya mengisi `action`
yang masih kosong. Orang yang berubah pikiran tidak sedang berbohong, tapi
keputusan yang benar-benar diambil saat penayangan adalah yang pertama.

### Kebijakan lama tidak seragam

Pemilihan lama memberi bobot `max(1, budget − harga)`. Dengan budget Rp20.000,
tempat Rp5.000 berpeluang 75% dan tempat Rp15.000 berpeluang 25%.

Konsekuensinya: replay polos — "terima baris kalau pilihan kebijakan baru sama
dengan yang tercatat" — **mewarisi bias harga itu.** Karena itu `policy_score`
dicatat sejak sebelum trafik datang. Kolom yang tidak dicatat saat penayangan
tidak bisa ditambahkan belakangan.

### `weighted_budget_v2`: harga yang belum diketahui

Tempat dari OpenStreetMap tidak punya harga (`price_tier` null). Sejak migrasi
`20261027000001_harga_belum_diketahui.sql` mereka ikut jadi kandidat, tampil
sebagai "harga belum diketahui", dan mendapat **bobot 1** — sama dengan tempat
yang harganya persis di batas budget. Tidak ada yang menunjukkan tempat itu
murah, jadi ia diperlakukan sebagai pilihan paling berisiko, bukan diberi harga
tebakan. Bobot median atau rata-rata akan terlihat lebih "wajar" tapi sama
saja dengan menebak harga.

Karena aturan pemilihannya berubah, namanya ikut berubah: baris lama tetap
`weighted_budget_v1`, baris baru `weighted_budget_v2`. Evaluasi off-policy
memakai `policy_score` per baris, jadi keduanya tetap bisa dipakai bersama.

Akibat lain yang disengaja:
- "Jadi ke sini" tidak memotong saldo kalau harganya belum diketahui, dan
  `/api/wallet/deduct` menolak jumlah yang bukan bilangan bulat positif
- Fitur harga bandit untuk tempat seperti itu netral (0), bukan ditebak
- Pesan bagikan tidak menyebut harga sama sekali kalau belum diketahui

### Jebakan di `spin_events_labeled`

View itu dibuat dengan `select e.*` sebelum `policy_score`, `is_raining`, dan
`candidate_ids` ditambahkan. Postgres membekukan daftar kolom `*` saat view
dibuat, jadi **kolom-kolom itu tidak ada di view tersebut.** Kueri ekspor dan
view baru mengambil kolom dari `spin_events` dan hanya label dari
`spin_events_labeled`, supaya aturan "diabaikan setelah 5 menit" tetap
didefinisikan di satu tempat.

### Konteks cuaca

Mati secara default; nyalakan dengan `ENABLE_WEATHER_CONTEXT=true` (memanggil
Open-Meteo). Jalur spin tidak pernah menunggu jaringan: nilai dibaca dari cache
10 menit, dan kalau dingin tercatat `null`. Koordinat dibulatkan ke ~11 km
sebelum dikirim keluar, jadi lokasi persis pengguna tidak sampai ke pihak
ketiga.

---

## Fungsi fitur

`buildFeatureVector(input) → number[26]`, di `src/lib/ml/features.ts`. Murni:
tidak menyentuh jaringan, tidak membaca jam, tidak membaca database.

| Blok | Dim | Indeks | Isi |
|---|---|---|---|
| Jarak | 2 | 0–1 | `−log(1+km)` dan `1/(1+km)` |
| Harga | 2 | 2–3 | Tingkat harga, selisih dari kebiasaan pengguna |
| Masakan | 12 | 4–15 | One-hot slot |
| Waktu | 4 | 16–19 | Jam melingkar (sin/cos), akhir pekan, jam makan |
| Cuaca | 1 | 20 | +1 hujan, −1 tidak, 0 tidak tahu |
| Afinitas pengguna | 2 | 21–22 | Accept rate pengguna untuk kategori dan tingkat harga ini |
| Popularitas | 2 | 23–24 | Accept rate dan jumlah tayang restoran |
| Bias | 1 | 25 | Konstanta |

Keputusan yang perlu diketahui sebelum menyentuh berkas ini:

- **Urutan `FEATURE_NAMES` tidak boleh diubah** tanpa melatih ulang. Artefak
  menyimpan nama fiturnya, dan `parseModelArtifact` menolak memuat artefak yang
  susunannya tidak cocok — satu blok yang disisipkan di tengah menggeser semua
  bobot, dan modelnya tetap "jalan" dengan rekomendasi omong kosong.
- **Daftar slot pendek dan tetap.** One-hot yang tumbuh mengikuti isi database
  mengubah panjang vektor setiap ada kategori baru.
- **Afinitas dan popularitas dihaluskan lalu dipusatkan pada nol.** Rasio 1/1
  dan 40/50 bukan bukti yang sama kuatnya; tanpa penghalusan, restoran yang
  baru sekali tayang dan kebetulan diterima langsung mendominasi.
- **Yang tidak diketahui tetap netral.** Harga yang belum dikurasi memberi 0,
  bukan tingkat 2.

### Kebocoran dicegah secara struktural

`PriorTracker` (di `training.ts`) dipakai bersama oleh pelatihan, evaluasi, dan
penyajian. Baris diproses menurut `shown_at`; fitur dihitung dari pencacah yang
isinya hanya baris sebelumnya; pencacah diperbarui **sesudah** fiturnya dibuat.
Tidak ada jalan bagi hasil sebuah baris untuk memengaruhi fiturnya sendiri.

Ditulis di TypeScript, bukan SQL window function atau Python, dengan sengaja:
satu fungsi fitur untuk pelatihan dan penyajian. Dua implementasi cepat atau
lambat berbeda, dan bug seperti itu tidak muncul di tes mana pun sampai
modelnya sudah dipakai orang.

---

## Kurasi kategori dengan LLM

**Status: alat selesai dan sedang dievaluasi, belum dijalankan ke data nyata.**
Per 26 Oktober 2026, 16 dari 32 tempat di database (50%) masih jatuh ke
`lainnya`. Cakupan aplikasi diperluas ke Bandung, dan di skala itu kurasi
tangan tidak lagi realistis — itulah alasan kurasi otomatis ini ada. Di 32
warung, melabel tangan 15 menit lebih masuk akal daripada LLM.

Sebagian besar katalog berkategori "Restaurant" polos, yang jatuh ke slot
`lainnya`. Selama itu belum dikurasi, **12 dari 26 dimensi fitur praktis
kosong.** `scripts/categorize-llm.ts` mengirim nama tiap tempat yang sekarang
jatuh ke `lainnya` ke LLM, dengan skema JSON yang membatasi jawaban ke 12 slot.

Tiga provider di `scripts/lib/llm-providers.ts`, dengan prompt, skema, dan
validasi yang sama persis:

| Provider | Model | Batch | Biaya | Catatan |
|---|---|---|---|---|
| `ollama` (default) | `qwen2.5:7b` di laptop | 10 | Gratis | Jalan di CPU, ~14 detik per nama di laptop pengembang; di-stream supaya tidak kena batas 300 detik `fetch`, dan mencoba ulang kalau Ollama mati. **Kalah dari baseline Naive Bayes di evaluasi** |
| `gemini` | `gemini-3.5-flash-lite` | 40 | Free tier; berbayar $0,30/$2,50 per 1 juta token (dicek 26 Okt 2026) | Interactions API. Data free tier dipakai Google untuk meningkatkan produknya — boleh untuk nama OSM publik, **jangan untuk teks pengguna**. Tidak ada pengaturan temperatur yang terdokumentasi |
| `claude` | `claude-opus-5-5`, effort `low` | 40 | Berbayar | Butuh `ANTHROPIC_API_KEY` dan saldo |

Mana yang dipakai ditentukan oleh [evaluasi](#evaluasi-kategorisasi), bukan
oleh reputasi modelnya.

Qwen 2.5 dipilih untuk default karena dukungan bahasa Indonesianya baik di
ukuran yang muat di RAM laptop. Model lain bisa dipakai lewat `OLLAMA_MODEL`.
Karena keluarannya tetap SQL untuk direview, model yang lebih lemah tidak
langsung merusak data — ia cuma membuat berkas review perlu dibaca lebih teliti.

Bentuknya sama dengan ingest OSM — **SQL untuk direview, tidak pernah menulis
langsung**:

- **Yang tidak yakin tidak ditulis.** Slot `lainnya` dan confidence di bawah
  ambang (default `sedang`) hanya muncul di berkas review
- **Kurasi manusia selalu menang.** Tiap UPDATE menyertakan kategori lamanya di
  WHERE; baris yang sudah diubah tangan di antara saat skrip jalan dan saat SQL
  ditempel tidak tertimpa
- **Kategori yang sudah jelas tidak disentuh**
- **Label yang ditulis dikunci tes**: `toCuisineSlot(label)` harus kembali ke
  slot yang dimaksud, karena label yang jatuh ke slot lain akan diam-diam
  merusak fitur
- **Kegagalan tidak dibuang diam-diam.** Jawaban yang bukan JSON sah, id yang
  salah salin, atau penolakan model tercatat sebagai "tanpa jawaban" di berkas
  review. Untuk Claude, `fallbacks: "default"` mengulang permintaan di model
  cadangan kalau classifier keamanan salah menolak

Katalog dibaca dengan anon key, karena memang publik.

**Yang sengaja tidak dilakukan LLM: menebak harga.** Harga adalah filter yang
paling sering dipakai, dan menebaknya berarti membohongi filter itu.

---

## Evaluasi kategorisasi

**Pertanyaannya: apakah LLM layak dipakai untuk kurasi kategori, dan yang
mana?** Dijawab dengan membandingkan beberapa pendekatan di test set yang sama,
dengan label yang dibuat manusia, bukan dengan contoh pilihan.

```bash
npm run ml:eval-categorize                                  # baseline + laporan
npm run ml:eval-categorize -- --provider=ollama             # + qwen2.5:7b
npm run ml:eval-categorize -- --provider=ollama --model=qwen2.5:3b
npm run ml:eval-categorize -- --provider=gemini
npm run ml:snapshot-osm                                     # perbarui snapshot (jarang)
```

### Data dan label

Sumbernya tag `cuisine` OpenStreetMap: **12.174 tempat makan bernama di
Indonesia** (snapshot 26 Oktober 2026, `ml/eval/osm-cuisine.json`, ODbL —
lihat `ml/eval/ATTRIBUTION.md`). Evaluasi membaca berkas ini, bukan Overpass,
supaya angkanya bisa diulang persis.

Tagnya tidak bersih, jadi label emas ditentukan **pedoman eksplisit**
(`GOLD_MAP` di `src/lib/ml/eval/dataset.ts`), bukan pencocokan kata kunci:

- Ada 700+ nilai berbeda. Nilai yang bukan masakan atau terlalu umum
  (`asian`, `local`, `international`, `breakfast`) diabaikan
- Nilai yang tidak ada di pedoman → baris dibuang, dan dihitung
- `nusantara` + satu slot spesifik → slot spesifiknya (`indonesian;sundanese`
  → `sunda`). Dua slot spesifik (`chicken;burger`) → dibuang, karena memilih
  salah satu berarti menghukum model untuk ambiguitas yang ada di label
- **Satu item per nama unik.** KFC muncul 340 kali; tanpa dedup, test set
  didominasi segelintir merek dan pengklasifikasi cukup menghafal nama.
  Nama yang sama dengan label berbeda dipakai kalau ≥70% labelnya sepakat
- **Split dari hash nama** (train 70 / dev 10 / test 20). Nama yang sama selalu
  jatuh ke split yang sama, termasuk setelah snapshot diperbarui

Hasilnya 7.346 nama unik (train 5.102, dev 765, test 1.479). Yang dibuang:
993 multi-slot, 644 hanya nilai umum, 550 tidak dipetakan, 268 label
bertentangan.

Definisi slot di prompt (`SLOT_GUIDE`) diselaraskan dengan pedoman ini —
misalnya KFC masuk `ayam`, bukan `barat`. Itu bukan mengajari model jawaban
test: anotator dan model harus memakai definisi kelas yang sama, kalau tidak
model dihukum karena mengikuti instruksinya.

### Subset

LLM hanya dinilai di **subset berimbang**: paling banyak 50 nama per slot dari
split test, 509 nama. Distribusi aslinya didominasi `nusantara` dan
`kopi_minuman`; tanpa pembatasan, menebak kelas mayoritas sudah memberi akurasi
lumayan. Tiap metrik dilaporkan untuk tiga irisan:

| Irisan | Isi | Kenapa |
|---|---|---|
| `semua` | 509 nama | Angka utama |
| `tanpa_kata_kunci` | 323 nama yang tidak menyebut makanannya (`toCuisineSlot(nama)` → `lainnya`) | Di sinilah LLM harus menang. Kalau tidak, aturan kata kunci sudah cukup |
| `non_waralaba` | 497 nama yang muncul < 3 kali di OSM | Paling mirip warung yang benar-benar dikurasi |

### Metode

| Metode | Isi |
|---|---|
| `keyword` | `toCuisineSlot(nama)` — aturan kata kunci yang sudah dipakai aplikasi |
| `naive-bayes` | Multinomial NB atas n-gram huruf 2–4 + kata, dilatih di train, α dipilih dari macro-F1 di dev. ~100 baris TypeScript, dilatih dalam 1 detik |
| LLM | Lewat provider yang sama dengan produksi, nama dikirim dengan `kategori_sekarang: "Restaurant"` seperti kondisi aslinya |

### Metrik

- **Macro-F1 sebagai angka utama**, akurasi di sampingnya, keduanya dengan
  interval 95% bootstrap
- **Presisi pada saran yang akan ditulis** — bukan `lainnya` dan confidence ≥
  `sedang`, aturan yang sama dengan `suggestionsToSql`. Ini metrik yang paling
  dekat dengan produksi: saran yang tidak ditulis cuma membiarkan warung di
  `lainnya`, saran salah yang ditulis meracuni fitur bandit sebagai fakta
- **Tingkat gagal** (JSON rusak, id hilang, penolakan) dihitung sebagai salah,
  bukan dibuang dari penyebut
- **Uji McNemar eksak** untuk membandingkan dua metode pada item yang sama.
  Lebih tepat daripada membandingkan dua interval, karena kesalahan dua metode
  pada item yang sama saling berkorelasi
- **Biaya per 1.000 warung** dari token yang dilaporkan provider × harga resmi
  yang dicek pada tanggal yang tertulis; **latensi** p50/p95 per batch dan
  waktu per 1.000 warung

Jawaban LLM di-cache per item di `ml/eval/cache/`, ditandai sidik prompt.
Mengubah prompt membuat cache lama tidak dipakai; laporan bisa dibuat ulang
tanpa biaya. **Prompt diutak-atik di `--split=dev`, angka akhir dari `test`.**

### Hasil

Split test, subset berimbang 509 nama, 27 Oktober 2026. Laporan lengkap
(irisan lain, F1 per slot, confusion matrix) di `ml/eval/results.test.md`.

| Metode | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥ `sedang` → presisi | Ditulis ≥ `tinggi` → presisi |
|---|---|---|---|---|---|
| keyword | 37,1% (32,8–41,5) | 0,39 (0,33–0,44) | 0% | 36,5% → 76,3% | 36,5% → 76,3% |
| naive-bayes (α=0,3) | 56,4% (52,1–60,5) | 0,52 (0,47–0,56) | 0% | 85,5% → 57,9% | 80,0% → 59,7% |
| **gemini-3.5-flash-lite** | **64,0%** (60,1–68,2) | **0,65** (0,60–0,69) | 0% | 75,2% → 72,8% | 51,5% → **82,4%** |
| qwen2.5:7b (Ollama, CPU) | 47,0% (42,6–51,3) | 0,46 (0,41–0,50) | 0% | 78,8% → 54,6% | 54,0% → 67,6% |
| qwen2.5:3b (Ollama, CPU) | 20,2% (16,9–23,8) | 0,23 (0,19–0,27) | 34,6% | 32,0% → 51,5% | 15,1% → 67,5% |

Di irisan **tanpa kata kunci** (323 nama yang tidak menyebut makanannya),
macro-F1: Gemini 0,53, Naive Bayes 0,41, Qwen 7B 0,26, Qwen 3B 0,10, keyword
0,02.

| Metode | Token in/out per nama | USD per 1.000 warung | Waktu per 1.000 warung |
|---|---|---|---|
| gemini-3.5-flash-lite | 45 / 62 | $0,17 (harga berbayar; free tier $0) | 14 menit |
| qwen2.5:7b | 90 / 44 | $0 + listrik | 3,8 jam |
| qwen2.5:3b | 90 / 33 | $0 + listrik | 1,5 jam |
| keyword, naive-bayes | — | $0 | < 1 detik |

Semua perbedaan berpasangan signifikan menurut McNemar (p < 0,01). Yang
paling penting, dan paling tipis: Gemini vs Naive Bayes, 88 lawan 49 item yang
hanya benar di salah satunya (p = 0,0011).

**Kesimpulan**

1. **Gemini 3.5 Flash-Lite dipakai untuk kurasi Bandung**, dengan
   `--min-confidence=tinggi`. Ia satu-satunya metode yang lebih baik dari Naive
   Bayes, dan biayanya praktis nol di skala ini
2. **Review manusia tetap wajib.** Bahkan di ambang `tinggi`, kira-kira 1 dari
   6 saran yang ditulis salah. Ambang `tinggi` awalnya dipilih sambil melihat
   angka test, jadi dikonfirmasi ulang di split dev yang belum pernah dipakai
   memilih apa pun (402 nama, `ml/eval/results.dev.md`): **54,7% ditulis,
   presisi 83,6%** (184 dari 220), sejalan dengan 51,5% → 82,4% di test
3. **Model lokal kalah dari baseline yang dilatih.** Qwen 7B di bawah Naive
   Bayes 100 baris, dan butuh hampir 4 jam. Untuk tugas sesempit ini, data
   latih yang relevan mengalahkan model umum yang kecil
4. **Ambang confidence lebih menentukan daripada pilihan model** untuk
   kualitas data yang masuk. Naik dari `sedang` ke `tinggi` menaikkan presisi
   Gemini 10 poin dengan mengorbankan cakupan

**Mode gagal yang ditemukan** — lebih berguna untuk interview daripada angka
akurasinya:

- **Qwen 3B berhenti setelah satu jawaban.** Di 18 dari 51 batch, ia mengisi
  array dengan id pertama lalu menutupnya. JSON-nya sah dan sesuai skema, jadi
  structured output tidak mencegahnya: skema menjamin *bentuk*, bukan
  *kelengkapan*. Deterministik di temperatur 0. Perbaikan yang bisa dicoba:
  `minItems`/`maxItems` sebesar batch di skema (Ollama memaksakannya lewat
  grammar), atau batch 1 untuk model kecil
- **Qwen 7B membuang keraguan ke `nusantara`/`sedang`** (82 dari 509 jawaban)
  alih-alih `lainnya`/`rendah`. Karena `sedang` lolos ambang tulis, tebakan ini
  masuk ke SQL: dari 109 tebakan `nusantara`, hanya 26 yang benar
- **Alasan bisa salah walau slotnya benar.** Qwen 7B menulis "CFC adalah
  singkatan dari Chicken Fast Food" (seharusnya California Fried Chicken) dan
  "Yoshinoya adalah merek mie instan Jepang". Kolom `reason` di berkas review
  bukan bukti
- **Ollama 7B dibunuh OOM killer** setelah 2 jam, saat proses model memakai
  7,4 GB di laptop 14 GB yang juga menjalankan browser. Provider Ollama sekarang
  mencoba ulang saat koneksi putus. "Gratis" di laptop tanpa GPU berarti RAM
  habis, CPU 100% berjam-jam, dan run yang bisa mati di tengah jalan

**Sebagian kesalahan adalah batas taksonomi, bukan kebodohan model.** Di semua
metode, kebingungan terbesar sama: `chinese` ↔ `mie` (bakmi, kwetiau),
`seafood` ↔ `nusantara` ("RM Bahari"), `lainnya` ↔ `barat` (masakan asing).
Model yang lebih besar tidak akan menghapusnya; definisi slot yang lebih tegas
bisa.

### Batasan

- **Slot `sunda` hampir tidak terukur**: hanya 36 nama di seluruh dataset, 7 di
  subset test. Warung Sunda di OSM kebanyakan ditag `indonesian` atau
  `regional`. Ironisnya ini slot terpenting untuk Bandung. Butuh test set kecil
  berlabel tangan dari Bandung untuk mengukurnya
- **Distribution shift**: nama OSM yang punya tag `cuisine` kemungkinan lebih
  mudah daripada warung "Restaurant" yang benar-benar perlu dikurasi
- **Label OSM juga bisa salah.** Akurasi di sini adalah kecocokan dengan
  penanda OSM, bukan kebenaran mutlak
- Ukuran batch berbeda antar provider (10 lokal, 40 API), mengikuti
  konfigurasi produksi masing-masing

---

## Model: Thompson Sampling

Regresi linear Bayesian: `A ← A + xxᵀ`, `b ← b + rx`, lalu memilih
`argmax θ̃ᵀxᵢ` dengan `θ̃ ~ N(θ̂, σ²A⁻¹)`. A⁻¹ diperbarui lewat Sherman–Morrison
(O(d²) per ronde). Faktor Cholesky dihitung saat pelatihan dan ikut disimpan,
jadi penyajian tidak melakukan dekomposisi apa pun.

### Hasil simulasi

1.500 ronde, 40 pengguna, 60 restoran, benih 20260804. Angkanya dicetak ulang
oleh `npm test`, jadi tidak pernah basi.

| Kebijakan | Accept | Regret | Coverage |
|---|---|---|---|
| *oracle (batas atas)* | *72,1%* | *0* | — |
| LinUCB (α=0,5) | 65,7% | **70,6** | 57% |
| Thompson Sampling | 65,0% | 89,6 | **77%** |
| ε-greedy (ε=0,1) | 64,7% | 111,3 | 100% |
| Jarak terdekat | 55,9% | 266,1 | 37% |
| Uniform random | 44,9% | 428,5 | 100% |

Thompson menurunkan cumulative regret **79% dibanding acak seragam.**

**LinUCB menang di regret, Thompson menang di cakupan katalog.** Untuk produk
ini cakupan bukan hiasan: sistem yang cuma merekomendasikan segelintir tempat
teratas gagal sebagai produk walau accept rate-nya tinggi. Jadi pilihannya
trade-off yang disebut apa adanya, bukan "yang skornya paling bagus".

Keputusan yang menentukan hasilnya:

- **`θ*_u = θ_bersama + deviasi kecil`.** Model belajar satu θ untuk semua
  pengguna; kalau tiap pengguna sintetis diberi θ* yang sepenuhnya bebas,
  Thompson kalah dari "ambil yang terdekat" — yang terukur di situ
  ketidakcocokan model dan lingkungan karangan, bukan mutu model
- **σ = 0,3, bukan 1.** Dengan 26 dimensi dan hadiah biner, posterior yang lebar
  membuat Thompson jadi hampir-acak. Parameter pertama yang dicurigai kalau
  hasilnya mengecewakan
- **Ablasi membutakan kebijakannya saja**, bukan lingkungannya; kalau keduanya
  dibutakan, oracle-nya ikut bergeser dan angka regret tidak sebanding.
  `ablateBlock(x, "masakan")` dan seterusnya

### Batasan — baca sebelum mengutip angka mana pun

**Hasil simulasi bukan bukti sistem bekerja pada manusia.** Pengguna sintetis
linear dan stasioner: tidak bosan, tidak dipengaruhi teman di grup chat.
`P(accept) = sigmoid(θ*ᵀx)` mengasumsikan hadiahnya benar-benar fungsi dari
fitur yang kita punya. Angka di atas hanya bukti bahwa modelnya belajar *kalau
dunianya seperti yang diasumsikan.*

---

## Evaluasi off-policy

`src/lib/ml/evaluation.ts`, dijalankan lewat `npm run ml:evaluate`.

Pertanyaannya: seandainya kebijakan baru yang memilih pada penayangan yang
sudah tercatat, berapa accept rate-nya? Dijawab tanpa menayangkan apa pun ke
pengguna — inilah "shadow mode" proyek ini.

```
w     = π_baru(a|x) / p_lama(a|x)
IPS   = (1/n) Σ w·r
SNIPS = Σ w·r / Σ w
```

- **Log dibagi menurut waktu**, default 70/30. Membagi secara acak membocorkan
  masa depan ke pelatihan
- **SNIPS angka utama**, IPS di sampingnya, plus interval 95% dari bootstrap
- **Effective sample size** `(Σw)²/Σw²` dicetak dan diberi peringatan kalau di
  bawah 10% n. Kebijakan lama berbobot harga, jadi kandidat mahal punya
  `policy_score` kecil dan bobot IPS besar — hasilnya bisa ditentukan segelintir
  baris
- **Bobot dibatasi di 100** (`maxWeight`), dan jumlah baris yang terpotong
  dicetak. Pengguna bisa menyisipkan baris `spin_events` sendiri lewat anon
  key; tanpa batas, satu baris palsu dengan `policy_score` 0,0001 dan
  `accepted` berbobot 10.000 dan menentukan seluruh SNIPS. Batas menukar
  sedikit bias dengan ketahanan; penutup penuhnya butuh jalur tulis khusus
  server, yang bentrok dengan aturan tanpa `service_role`

Tesnya membangun dunia dengan jawaban yang diketahui: kebijakan pengumpul yang
hanya 25% memilih warung yang bagus. Accept rate yang tercatat 0,35; estimator
harus mengembalikan nilai sebenarnya, 0,8 — dan memang begitu.

Pada data sintetis 3.000 spin, interval Thompson masih 9–68% dengan ESS ~11.
Itu bukan bug; itu gambaran jujur betapa sedikitnya yang bisa disimpulkan dari
data setipis itu.

Keterbatasan: kategori dan harga kandidat yang **tidak** terpilih direkonstruksi
dari katalog saat analisis, bukan dibekukan. Untuk dua kolom yang jarang
berubah galatnya kecil — berbeda dari waktu dan cuaca, yang memang dibekukan.

---

## Penyajian di belakang flag

**Mati secara default.**

| Variabel | Default | Arti |
|---|---|---|
| `BANDIT_ROLLOUT` | `0` | Porsi pengguna yang dilayani bandit, 0–1 |
| `BANDIT_BUNDLE_PATH` | `ml/bandit.json` | Lokasi bundle |
| `BANDIT_ALLOW_SYNTHETIC` | — | `true` hanya untuk mencoba alurnya secara lokal |

### Propensity untuk baris bandit

Thompson biasa mengambil argmax dari satu tarikan θ̃, dan peluang sebuah
kandidat menang di bawah aturan itu tidak punya bentuk tertutup. Tanpa peluang
itu, log dari bandit tidak bisa dievaluasi — kesalahan yang sama dengan yang
hampir terjadi pada `weighted_budget_v1`.

`policy.ts` menarik θ̃ 200 kali, menghitung frekuensi menang tiap kandidat,
mencampurnya dengan ε = 0,1 seragam, lalu **mengundi dari distribusi itu.**
Karena pengundiannya benar-benar dari distribusi yang dicatat, `policy_score`
adalah peluang sebenarnya. Campuran ε menjamin tidak ada kandidat berpeluang
nol, yang akan membuat bobot IPS tak terhingga.

### Perilaku

- **Pembagian per pengguna, deterministik** (hash FNV-1a dari `user_id`).
  Pengguna yang berpindah kelompok membuat A/B mengukur campuran
- **Spin tidak pernah gagal karena bandit.** Bundle hilang, rusak, sintetis,
  kurang dari 500 contoh, atau query riwayat gagal — semuanya kembali ke
  `weighted_budget_v1` dengan satu peringatan di log
- **Satu round trip tambahan** untuk kelompok perlakuan, dijalankan bersamaan
  dengan query kandidat. Kelompok kontrol tidak menyentuh jaringan sama sekali
- **Popularitas restoran dibekukan di bundle** (`snapshot`), karena route
  handler tidak bisa membaca log pengguna lain tanpa service_role. Nilainya
  basi sampai pelatihan berikutnya. Afinitas pengguna dibaca segar lewat view
  `spin_history_for_bandit`, dibatasi RLS lewat `security_invoker`
- `next.config.ts` memasukkan `ml/*.json` ke trace `/api/spin`, dan `serve.ts`
  memakai `turbopackIgnore` supaya Turbopack tidak menelusuri seluruh proyek.
  Tanpa yang pertama, bundle tidak ikut ter-deploy dan bandit diam-diam tidak
  pernah menyala

---

## Cara menjalankan

### Mencoba alurnya tanpa data nyata

```bash
npm run ml:synthesize
npm run ml:evaluate -- --input=ml/data/synthetic-spins.json --restaurants=ml/data/synthetic-restaurants.json
npm run ml:train -- --input=ml/data/synthetic-spins.json --out=ml/data/synthetic-bandit.json
```

Kebijakan pengumpul sintetis bernama `synthetic_weighted_budget`, dan nama itu
yang membuat bundle hasilnya otomatis ditandai sintetis dan **ditolak saat
menyajikan**.

### Kurasi kategori

Butuh env Supabase di `.env.local`. Project URL ditulis **tanpa** `/rest/v1/`
di belakangnya — library Supabase menambahkannya sendiri, dan kalau ikut
ditulis hasilnya error "Invalid path specified in request URL".

**Dengan Ollama (gratis).** Pasang sekali:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:7b
```

Unduhan modelnya ~4,7 GB. Di Linux, installer memasang Ollama sebagai service
yang langsung berjalan; kalau tidak, jalankan `ollama serve` di terminal lain.

```bash
npm run ml:categorize -- --dry-run      # lihat yang akan dikirim, tanpa model
npm run ml:categorize -- --limit=10     # coba satu batch dulu
npm run ml:categorize                   # semuanya
```

**Dengan Claude.** Isi `ANTHROPIC_API_KEY` di `.env.local`, lalu tambahkan
`--provider=claude` ke perintah di atas.

Baca `supabase/generated/kategori-llm.review.md`, lalu tempel
`kategori-llm.sql` ke SQL Editor.

### Dengan data nyata

1. Jalankan migrasi `20261026000001_riwayat_bandit.sql`
2. Cetak kueri ekspor, jalankan di SQL Editor, unduh hasilnya sebagai CSV:
   ```bash
   npm run ml:evaluate     # tanpa argumen: mencetak kueri ekspor spin dan restoran
   ```
3. Evaluasi, lalu latih:
   ```bash
   npm run ml:evaluate -- --input=spins.csv --restaurants=restaurants.csv
   npm run ml:train -- --input=spins.csv
   ```
4. Commit `ml/bandit.json`, deploy, set `BANDIT_ROLLOUT=0.1`

Skrip membaca berkas ekspor, bukan database: RLS membuat anon key hanya melihat
baris sendiri, dan pelatihan dari berkas yang disimpan bisa diulang persis.

---

## Metrik

Jalankan dari Supabase SQL Editor. SQL Editor berjalan sebagai `postgres`,
jadi ia melihat semua baris.

### Retensi — angka yang paling menentukan

```sql
select cohort_date, users, returned_d1,
       round(100.0 * returned_d1 / nullif(users, 0), 1) as d1_pct,
       round(100.0 * returned_d7 / nullif(users, 0), 1) as d7_pct
from retention_by_cohort
order by cohort_date desc
limit 14;
```

**Kalau D1 di bawah 20%, jangan tambah fitur** — termasuk fitur AI. Model yang
lebih baik tidak menolong produk yang orang tidak mau buka dua kali.

### A/B per kebijakan

```sql
select policy,
       count(*) as tayang,
       count(*) filter (where effective_action = 'accepted') as diterima,
       round(100.0 * count(*) filter (where effective_action = 'accepted')
             / nullif(count(*), 0), 1) as accept_pct
from spin_events_labeled
where not is_pending
  and shown_at > now() - interval '30 days'
group by policy;
```

`not is_pending` penting: penayangan yang jendela responsnya belum habis belum
boleh dihitung sebagai penolakan.

### Cakupan katalog

```sql
select count(distinct restaurant_id) as pernah_tayang,
       (select count(*) from restaurants where is_active) as total_aktif
from spin_events
where shown_at > now() - interval '30 days';
```

Bandingkan per `policy` sebelum menyimpulkan bandit lebih baik. Accept rate
naik dengan cakupan yang menyempit drastis bukan kemenangan.

### Kandidat kosong

```sql
select radius_m, count(*) as kejadian,
       count(*) filter (where not coalesce(widening_helps, false)
                          and not coalesce(budget_helps, false)
                          and not coalesce(closed_only, false)) as memang_kosong
from spin_misses
where occurred_at > now() - interval '30 days'
group by radius_m
order by kejadian desc;
```

`memang_kosong` adalah lubang cakupan data yang nyata. Tidak ada model yang
bisa memperbaikinya — yang memperbaikinya kurasi.

### Latensi

```sql
select policy,
       percentile_cont(0.50) within group (order by latency_ms) as p50,
       percentile_cont(0.95) within group (order by latency_ms) as p95
from spin_events
where latency_ms is not null
  and shown_at > now() - interval '7 days'
group by policy;
```

Kelompok bandit diperkirakan sedikit lebih lambat (satu round trip riwayat).
Kalau selisih p95-nya lebih dari ~100 ms, itu perlu dilihat sebelum rollout
diperbesar.

### Melaporkan hasil

Mendeteksi kenaikan accept rate dari 20% ke 25% butuh sekitar **1.000+ spin
per kelompok.** Kalau datanya tidak sampai, laporkan apa adanya:

> n=180, selisih +4,2 pp, CI 95% [−3,1; +11,5], tidak signifikan.

Interval yang melewati nol beserta penjelasannya jauh lebih bisa dipercaya
daripada "meningkatkan akurasi 23%" dari 40 sampel.

---

## Rencana pengembangan

Urutannya ditentukan oleh apa yang membuka langkah berikutnya, bukan oleh apa
yang paling menarik dikerjakan.

### Tahap 1 — Bereskan data (bisa sekarang)

- [x] Evaluasi pendekatan kategorisasi di test set OSM
- [x] Harga yang tidak diketahui tampil sebagai "harga belum diketahui",
      tidak ditebak (`weighted_budget_v2`)
- [ ] Ingest Bandung dari OSM: `node scripts/ingest-osm.mjs --area=bandung`
      menghasilkan 1.870 tempat baru, 948 di antaranya jatuh ke `lainnya`.
      `fast_food` tanpa cuisine sekarang berlabel "Restoran", bukan "Cepat
      Saji" yang dipetakan ke `barat` — dari sampel, kebanyakan bukan masakan
      Barat (martabak, mi tektek, gerai ayam)
- [x] Konfirmasi ambang `tinggi` untuk Gemini di split dev (presisi 83,6%)
- [ ] Jalankan `ml:categorize -- --provider=gemini --min-confidence=tinggi`,
      review, tempel SQL-nya
- [ ] Ukur hasilnya: berapa persen katalog yang masih jatuh ke `lainnya`
      sebelum dan sesudah. Targetnya di bawah 25%
- [ ] Ulangi simulasi dengan proporsi `lainnya` yang baru, untuk memperkirakan
      berapa banyak blok masakan sekarang membantu

**Selesai kalau:** blok fitur masakan berisi informasi untuk sebagian besar
katalog.

### Tahap 2 — Kumpulkan data (butuh deploy)

- [ ] Deploy ke Vercel dengan env Supabase
- [ ] Checklist sebelum menyebar link di README terpenuhi — terutama
      Anonymous sign-ins dan `policy_score` yang terisi
- [ ] Kumpulkan **~500 spin berlabel**

**Selesai kalau:** `ml:evaluate` pada data nyata menghasilkan interval yang
tidak lagi selebar seluruh rentang.

### Tahap 3 — Nyalakan bandit (butuh Tahap 2)

- [ ] `ml:evaluate`. Lanjut hanya kalau batas bawah interval SNIPS Thompson di
      atas accept rate kebijakan sekarang
- [ ] `ml:train`, commit `ml/bandit.json`, `BANDIT_ROLLOUT=0.1`
- [ ] Pantau accept rate, cakupan, dan p95 per `policy` selama dua minggu
- [ ] Naikkan ke 0,5 kalau tidak ada yang memburuk

**Selesai kalau:** ada perbandingan A/B yang dilaporkan dengan interval
kepercayaannya, signifikan atau tidak.

### Tahap 4 — Fitur AI berikutnya (kandidat, pilih setelah Tahap 3)

| Ide | Jenis | Prasyarat | Catatan |
|---|---|---|---|
| **Penjelasan rekomendasi** — "dipilih karena dekat dan sesuai kebiasaan harga kamu" | Deterministik dari kontribusi `θ̂ᵢ·xᵢ` per blok | Bandit aktif | Tidak butuh LLM; tidak mengubah pilihan, jadi propensity tetap sah |
| **Permintaan bahasa alami** — "pengen yang berkuah, murah, deket" | LLM menerjemahkan ke filter dan preferensi slot | Tahap 1 | LLM hanya mengubah *filter*, bukan memilih warung. Catat sebagai `policy` baru |
| **Pelatihan ulang terjadwal** | Pipeline | Tahap 3 | Ekspor → evaluasi → latih mingguan; tolak otomatis kalau evaluasinya memburuk |
| **Model per pengguna** (LinUCB hibrid) | ML | ~5.000+ spin | Simulasi menunjukkan LinUCB unggul di regret; butuh data jauh lebih banyak |
| **Rekap bulanan** — jajan, kategori favorit, sisa budget | Data | Data dompet dan riwayat | Fitur retensi; bukan model |

Yang **sengaja tidak** ada di daftar: LLM yang menebak harga atau jam buka, dan
LLM yang memilih warung langsung. Keduanya merusak hal yang paling dijaga di
proyek ini — data yang jujur dan log yang bisa dievaluasi.

---

## Aturan yang tidak boleh dilanggar

1. **Konteks dibekukan saat penayangan**, tidak dihitung ulang dari `shown_at`
2. **Setiap penayangan dicatat**, bukan hanya yang diterima
3. **`policy` harus jujur.** Ganti `SPIN_POLICY` atau `BANDIT_POLICY` setiap kali
   aturan pemilihannya berubah
4. **`policy_score` harus peluang yang sebenarnya** dari pengundian yang
   benar-benar terjadi
5. **Yang tidak diketahui tetap `null`**, tidak pernah ditebak — baik oleh kode
   maupun oleh LLM
6. **Urutan `FEATURE_NAMES` tidak diubah** tanpa melatih ulang
7. **Tidak ada `service_role`**, di skrip mana pun
8. **Hasil simulasi dan data sintetis bukan bukti** tentang manusia
