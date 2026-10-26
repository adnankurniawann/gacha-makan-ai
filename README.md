# Gacha Makan

Aplikasi web untuk mahasiswa yang lapar tapi tidak bisa memutuskan mau makan
apa. Atur budget dan radius, tekan satu tombol, dapat **satu** warung — bukan
daftar dua puluh pilihan yang justru membuat keputusannya makin berat.

Fokusnya sempit dengan sengaja: **Jatinangor.** Kami tidak akan menang dalam
soal cakupan melawan Google Maps. Yang bisa dimenangkan adalah kurasi lokal di
wilayah dua kilometer — jam buka yang benar, harga yang benar, dan warung yang
memang dipakai mahasiswa.

---

## Daftar isi

- [Cara pakai](#cara-pakai)
- [Tech stack](#tech-stack)
- [Menjalankan secara lokal](#menjalankan-secara-lokal)
- [Perintah](#perintah)
- [Struktur proyek](#struktur-proyek)
- [Keputusan yang menentukan bentuk kodenya](#keputusan-yang-menentukan-bentuk-kodenya)
- [Menambah data restoran](#menambah-data-restoran)
- [Metrik](#metrik)
- [Rekomendasi berbasis model](#rekomendasi-berbasis-model)
- [Status dan keterbatasan](#status-dan-keterbatasan)
- [Berkontribusi](#berkontribusi)

---

## Cara pakai

1. Buka aplikasinya — **tidak perlu daftar.** Sesi dibuat otomatis di latar
2. Izinkan lokasi, atau pilih area sendiri kalau tidak mau
3. Atur budget dan radius, tekan **SPIN**
4. "Jadi ke sini", "Simpan buat nanti", atau spin lagi

Filter yang dipakai diingat untuk kunjungan berikutnya. Bisa dipasang ke home
screen sebagai PWA.

Akun baru ditawarkan saat ada yang benar-benar bisa hilang — dan mendaftar
belakangan **tidak menghapus riwayat**, karena emailnya dikaitkan ke sesi yang
sudah berjalan.

---

## Tech stack

| Bagian | Pilihan |
|---|---|
| Framework | Next.js 16 (App Router), monolith |
| Database | Supabase Postgres + PostGIS |
| Auth | Supabase, anonymous sign-in |
| Styling | Tailwind CSS 4, primitif shadcn |
| Huruf & ikon | Plus Jakarta Sans, lucide-react |
| Animasi | Framer Motion (dimuat setelah halaman siap) |
| Uji | Vitest — **360 tes** |
| ML & AI | Bandit TypeScript sendiri; LLM (Ollama lokal atau Claude) untuk kurasi kategori |

Tidak ada layanan terpisah. Bahkan model rekomendasinya dirancang muat di
dalam route handler yang sudah ada.

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
# Butuh ml/bandit.json yang dilatih dari data nyata — lihat docs/PENGEMBANGAN-AI.md.
# BANDIT_ROLLOUT=0.1

# Hanya untuk `npm run ml:categorize -- --provider=claude`. Default-nya Ollama
# lokal yang gratis dan tidak butuh key — lihat docs/PENGEMBANGAN-AI.md.
# ANTHROPIC_API_KEY=<key>
```

**Jangan pernah menaruh `service_role` key di sini atau di mana pun.** Aplikasi
ini tidak memakainya, dan sebaiknya tetap begitu — key itu melewati seluruh
Row Level Security.

### 3. Database

Di Supabase SQL Editor, jalankan **satu per satu, berurutan**. Buka berkasnya,
salin isinya, Run — bukan menempelkan nama berkasnya.

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
```

Semuanya idempoten, jadi aman diulang kalau ragu sudah pernah dijalankan.

Cek semuanya masuk:

```sql
select
  to_regclass('public.opening_hours') is not null as fase_b,
  to_regclass('public.spin_events')   is not null as fase_d,
  to_regclass('public.spin_misses')   is not null as fase_e,
  exists(select 1 from information_schema.columns
         where table_name = 'spin_events' and column_name = 'candidate_ids') as ml_fase_3;
```

Keempatnya harus `true`.

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

  Tanpa ini tidak ada yang rusak — `spin_events_labeled` tetap memperlakukan
  penayangan lewat 5 menit sebagai `ignored` — tapi tabelnya tidak rapi

### 5. Buktikan RLS-nya benar

```bash
node scripts/verify-rls.mjs
```

Skrip ini memakai anon key yang sama dengan frontend, lalu **mencoba** operasi
terlarang. Percobaan tulisnya dirancang tidak merusak: DELETE dan INSERT
memakai UUID acak, UPDATE menulis ulang nilai yang sama persis.

Jangan percaya bahwa policy sudah benar hanya karena aplikasinya masih jalan.
Aplikasi yang jalan cuma membuktikan jalur yang diizinkan masih terbuka —
bukan bahwa jalur yang terlarang sudah tertutup.

### 6. Jalankan

```bash
npm run dev
```

---

## Perintah

```bash
npm run dev                                     # server pengembangan
npm test                                        # 360 tes
npm run lint                                    # eslint
npm run build                                   # build produksi

node scripts/verify-rls.mjs                     # buktikan kebijakan RLS
node scripts/bundle-size.mjs                    # ukuran bundle per halaman
node scripts/ingest-osm.mjs --area=jatinangor   # tarik data dari OpenStreetMap
node scripts/csv-to-seed.mjs                    # ubah kurasi manual jadi SQL

npm run ml:categorize                           # kurasi kategori dengan LLM lokal → SQL
npm run ml:evaluate -- --input=... --restaurants=...  # evaluasi off-policy
npm run ml:train -- --input=...                 # latih bandit → ml/bandit.json
npm run ml:synthesize                           # log sintetis untuk mencoba alurnya
```

`bundle-size.mjs` dijalankan setelah `npm run build`. Next 16 dengan Turbopack
tidak lagi mencetak tabel "First Load JS", jadi angkanya dibaca dari tag
`<script>` di HTML hasil prerender — daftar berkas yang benar-benar diminta
browser.

---

## Struktur proyek

```
src/app/            Halaman dan route handler
  api/              spin, spin/action, report, favorites, restaurants, wallet
  spin/ blind/      Dua cara mendapatkan hasil
  map/ riwayat/     Peta dan riwayat
  dompet/           Budget makan bulanan
  hasil/[id]/       Halaman hasil yang bisa dibagikan, plus Open Graph image
src/components/
  ui/               Primitif bersama: shadcn + surface.tsx milik aplikasi
  home/             Header, navigasi bawah, hero, panduan, feed
src/lib/
  supabase/         Klien, query, pencatatan peristiwa, sesi
  ml/               Fitur, bandit, simulator, evaluasi, penyajian, kurasi LLM
  rate-limit.ts     Sliding window per IP
src/utils/          Logika murni: seleksi gacha, geo
supabase/           Skema dan migrasi
scripts/            Ingest, verifikasi, pengukuran, pipeline ML
docs/               Dokumentasi pengembangan
data/               Template kurasi manual
```

Bagian AI dan machine learning — arsitektur, keputusan, cara menjalankan,
metrik, dan rencana berikutnya — ada di
[docs/PENGEMBANGAN-AI.md](docs/PENGEMBANGAN-AI.md).

---

## Keputusan yang menentukan bentuk kodenya

**Klien tidak punya hak tulis ke tabel mana pun yang penting.** Anon key ada di
bundle JavaScript yang dikirim ke browser, jadi apa pun yang bisa dilakukan
pemegangnya harus dianggap sudah dilakukan orang asing. Perubahan skor
kebersihan lewat fungsi `security definer`, bukan `UPDATE` langsung.

**Jam buka punya tiga keadaan, bukan dua.** `true`, `false`, dan `null` untuk
belum terdata. Menganggap "belum tahu" sebagai tutup akan mengosongkan katalog;
menganggapnya buka akan mengirim orang ke warung yang sudah tutup. Pencarian
memakai `is not false`.

**Ingest OSM menghasilkan SQL untuk direview, bukan menulis langsung.**
Deduplikasi berbasis kemiripan nama tidak pernah 100% benar, dan menggabungkan
dua warung berbeda jadi satu baris jauh lebih sulit dibereskan daripada
membaca daftarnya dulu.

**Setiap penayangan hasil spin dicatat beserta konteks yang dibekukan saat itu,**
termasuk peluang kebijakan memilihnya dan seluruh kandidat yang tersedia. Bukan
analytics — ini fondasi data untuk model rekomendasi.

**Yang tidak diketahui tetap `null`, tidak pernah ditebak.** Harga yang belum
dikurasi, cuaca yang belum terbaca, jam buka yang tidak bisa diurai. Menebaknya
berarti menanam fitur palsu ke dalam data latih — dan itu baru ketahuan setelah
modelnya dipakai orang.

---

## Menambah data restoran

Dua jalur, keduanya sah.

### Otomatis — OpenStreetMap

```bash
node scripts/ingest-osm.mjs --area=jatinangor
```

Menghasilkan `supabase/generated/jatinangor.sql` dan `.review.md`. **Baca yang
review dulu** — di situ tercatat baris mana yang dianggap duplikat dan kenapa.

### Manual — dari Google Maps

1. Isi `data/kurasi-restoran.csv`
2. `node scripts/csv-to-seed.mjs`
3. Review SQL-nya, lalu tempel ke SQL Editor

Validasinya menangkap **latitude dan longitude yang tertukar** — kesalahan
paling umum saat menyalin dari peta, dan yang paling sulit disadari karena
hasilnya titik di tengah Samudra Hindia yang tidak pernah muncul di radius
siapa pun.

> **Lisensi:** dari Google Maps boleh menyalin **fakta** — nama, koordinat,
> alamat, jam buka. **Jangan menyalin teks ulasan atau foto**; menyimpannya
> secara permanen melanggar ToS Google Maps Platform.

Baris hasil ingest masuk **tanpa harga**, dan tanpa harga ia tidak muncul di
hasil spin. Itu disengaja: menebak harga berarti membohongi filter yang paling
sering dipakai. Ingest 300 tempat **tidak** langsung membuat katalog spin jadi
300 — yang bertambah adalah antrean kurasi.

---

## Metrik

Tidak ada panel admin; Supabase Studio sudah cukup. Kueri lainnya — A/B per
kebijakan, cakupan katalog, kandidat kosong, latensi — ada di
[docs/PENGEMBANGAN-AI.md](docs/PENGEMBANGAN-AI.md#metrik).

Satu angka yang paling menentukan sekarang:

```sql
select cohort_date, users, returned_d1,
       round(100.0 * returned_d1 / nullif(users, 0), 1) as d1_pct
from retention_by_cohort
order by cohort_date desc
limit 14;
```

**Kalau D1 di bawah 20%, jangan tambah fitur** — cari tahu kenapa orang tidak
kembali.

---

## Rekomendasi berbasis model

Contextual bandit dengan Thompson Sampling di atas regresi linear Bayesian.
Seluruh pipeline-nya sudah ada dan teruji — fitur, simulator, pelatihan,
evaluasi off-policy, dan penyajian di `/api/spin` di belakang flag
`BANDIT_ROLLOUT`. **Flag-nya mati, dan belum ada model yang dilatih dari data
nyata.**

```
kurasi kategori (Claude) → katalog lebih kaya → spin_events
  → ml:evaluate (IPS/SNIPS, train/test menurut waktu)
  → ml:train → ml/bandit.json → /api/spin (BANDIT_ROLLOUT)
```

Kurasi kategorinya memakai LLM karena masalahnya masalah bahasa: sebagian
besar katalog berkategori "Restaurant" polos, yang membuat 12 dari 26 dimensi
fitur kosong. Hasilnya SQL untuk direview, bukan tulisan langsung — yang tidak
yakin tidak ditulis.

Di simulasi, Thompson menurunkan cumulative regret **79% dibanding acak
seragam** — tapi hasil simulasi bukan bukti sistem bekerja pada manusia.
Buktinya baru datang dari evaluasi pada data nyata, dan itu butuh ~500 spin.

Arsitektur, hasil lengkap, batasan, dan rencana berikutnya:
[docs/PENGEMBANGAN-AI.md](docs/PENGEMBANGAN-AI.md).

---

## Status dan keterbatasan

Yang sudah jalan: pencarian radius dengan filter jam buka, laporan kebersihan
dengan cooldown, sesi anonim, PWA, pencatatan umpan balik, kartu hasil yang
bisa dibagikan, riwayat dan favorit.

Yang jujur perlu disebut:

- **Cakupan data masih tipis.** Kurasi manual belum selesai, dan baris tanpa
  harga tidak muncul di hasil spin
- **Jam buka belum terisi untuk sebagian besar tempat.** Yang belum terdata
  tetap ditampilkan dengan label, bukan disembunyikan
- **Rate limit disimpan di memori proses**, jadi di serverless hitungannya per
  instance. Cukup menahan skrip iseng, bukan penyerang serius
- **Cooldown laporan per IP bisa diakali** — `x-forwarded-for` bisa dipalsukan.
  Pertahanan sebenarnya adalah hilangnya hak UPDATE, bukan cooldown-nya
- **Performa baru diukur lewat ukuran bundle**, belum lewat Lighthouse di
  perangkat sungguhan
- **Belum ada backup otomatis** — Supabase free tier tidak menyediakannya.
  Ambil dump manual sebelum data spin mulai berarti
- **Belum di-deploy**

### Sebelum menyebar link

Kolom yang tidak dicatat sekarang hilang selamanya — tidak ada cara
menambahkan kolom ke peristiwa yang sudah terjadi.

- [ ] Semua migrasi dijalankan
- [ ] Anonymous sign-ins aktif — tanpa ini **nol baris** tercatat
- [ ] `pg_cron` aktif dan `mark_ignored_spins()` terjadwal
- [ ] `select count(*) from spin_events` naik setelah kamu spin sendiri
- [ ] `policy_score` terisi, bukan null

---

## Asal proyek

Dikembangkan dari proyek Kelompok 7 PRD — Rafi Pradipta Andira Sulistyo,
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

- **Pakai `m.*`, bukan `motion.*`** — `MotionProvider` memuat mesin animasi
  belakangan, dan `motion.*` menariknya kembali ke bundle awal
- **`SessionBootstrap` harus mengimpor klien Supabase secara dinamis** — impor
  statis di root layout menambah ~60 kB ke setiap halaman
- **Jangan mengubah urutan `FEATURE_NAMES`** tanpa melatih ulang model; artefak
  yang susunannya tidak cocok akan ditolak saat dimuat
- **Ganti `SPIN_POLICY` atau `BANDIT_POLICY`** setiap kali aturan pemilihan
  berubah, supaya baris dari perilaku lama dan baru tetap bisa dipisahkan
- **Naikkan `VERSION` di `public/sw.js`** setiap kali berkas itu diubah — nomor
  itu yang memicu pembersihan cache lama

Jangan commit `.env.local`. Kalau sebuah key pernah ter-commit, rotasi di
Supabase Dashboard → Settings → API Keys; menghapusnya dari berkas tidak ada
gunanya karena riwayat git tetap menyimpannya.
