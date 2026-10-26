# Data restoran — Fase B

Aplikasi rekomendasi restoran nilainya sama dengan kualitas basis datanya.
**200–300 tempat dengan data lengkap mengalahkan 2.000 tempat dengan data
setengah.** Yang kedua terasa lebih mengesankan di angka dan lebih buruk di
tangan pengguna.

Keunggulan kita bukan cakupan — dalam soal cakupan kita akan kalah telak dari
Google Maps. Keunggulan kita adalah kurasi lokal di wilayah sempit.

## Urutan menjalankan

```bash
# 1. Migrasi Fase A dulu, kalau belum:
#    supabase/migrations/20260804000001_rls_hardening.sql
# 2. Lalu migrasi Fase B di Supabase SQL Editor:
#    supabase/migrations/20260804000002_jam_buka_dan_kualitas_data.sql
# 3. Baru ingest:
```

```bash
node scripts/ingest-osm.mjs --area=jatinangor
```

Skrip ini **tidak menulis ke database.** Ia menghasilkan dua berkas di
`supabase/generated/`:

| Berkas | Isi |
|---|---|
| `<area>.sql` | SQL untuk ditempel ke Supabase SQL Editor |
| `<area>.review.md` | Keputusan deduplikasi, untuk dibaca dulu |

Dua alasan kenapa bukan tulis langsung. Pertama, sejak Fase A anon key memang
tidak punya hak tulis ke `restaurants`, dan proyek ini sengaja tidak memakai
`service_role` key. Kedua, dan lebih penting: **deduplikasi berbasis kemiripan
nama tidak pernah 100% benar.** Menggabungkan dua warung berbeda jadi satu
baris jauh lebih sulit dibereskan daripada membaca daftar dulu.

Baca `.review.md`. Lalu jalankan `.sql`.

## Yang tidak akan langsung bertambah

Baris baru dari OSM masuk dengan **`price_tier` null**, dan baris ber-`price_tier`
null **tidak muncul di hasil spin** — filter budget `price_tier <= budget` tidak
pernah benar untuk null.

Ini disengaja. OpenStreetMap praktis tidak pernah punya data harga, dan
menebaknya berarti membohongi satu-satunya filter yang paling sering dipakai
mahasiswa. Jadi ingest 300 tempat **tidak** otomatis membuat katalog spin jadi
300. Yang bertambah adalah antrean kurasi:

```sql
select * from restaurant_curation_queue
 where 'harga' = any(missing_fields)
 order by array_length(missing_fields, 1);
```

Bagian membosankan inilah yang membuat produknya lebih baik daripada Google
Maps di wilayah ini. Tidak ada jalan pintasnya.

## Jam buka: tiga keadaan, bukan dua

`is_open_now()` mengembalikan `true`, `false`, atau **`null` kalau jam bukanya
belum terdata**. Keadaan ketiga itu bukan kelalaian.

Kalau "belum tahu" dianggap tutup, hari ini seluruh katalog hilang dari
pencarian — belum ada satu pun baris yang punya jam buka. Kalau dianggap buka,
kita diam-diam mengirim orang ke warung yang sudah tutup, dan itu justru
kerusakan yang paling ingin dihindari.

Jadi pencarian memakai `is_open is not false`: yang **pasti** tutup
disingkirkan, yang belum terdata tetap muncul dengan label "jam buka belum
terdata". Begitu kurasi selesai, perilakunya menyatu sendiri dengan "hanya yang
buka".

Jam buka disimpan dalam waktu lokal (`Asia/Jakarta`), `day_of_week` memakai
konvensi `0 = Minggu` — sama dengan `extract(dow)` di Postgres dan
`Date.getDay()` di JavaScript, jadi tidak ada konversi yang bisa salah di
tengah jalan. Warung yang tutup jam 2 pagi ditandai `crosses_midnight`.

## Deduplikasi

Urutan pengecekan, dari yang paling pasti:

1. **`osm_id` sama** — objek OSM yang sama, apa pun namanya sekarang. Ini juga
   yang membuat ingest ulang aman dijalankan berkali-kali.
2. **Nama mirip + berdekatan.** Ambangnya melonggar seiring jarak mengetat:

   | Jarak | Kemiripan nama minimum |
   |---|---|
   | ≤ 40 m | 0,60 |
   | ≤ 150 m | 0,85 |

Nama dinormalkan dulu: huruf kecil, tanpa diakritik, tanpa apostrof, lalu kata
yang tidak membedakan apa pun dibuang — `warung`, `warteg`, `rm`, `cafe`,
`kedai`, dan nama daerah yang ditempel di mana-mana seperti `jatinangor`.
"Warung Nasi Ibu Imas Jatinangor" dan "Nasi Ibu Imas" jadi hal yang sama.
Kemiripan dihitung dengan koefisien Dice atas bigram, yang tahan terhadap
perbedaan urutan kata.

Kalau setelah pembuangan tidak tersisa apa-apa (nama aslinya memang cuma
"Warung Jatinangor"), normalisasi dibatalkan — string kosong akan cocok dengan
semua string kosong lain, dan itu menggabungkan tempat-tempat yang tidak ada
hubungannya.

## Sumber data lain

**Google Places** kualitasnya terbaik dan punya free tier, tapi **baca
lisensinya**: menyimpan sebagian field secara permanen melanggar ToS. Aman
untuk `place_id` dan koordinat; jangan pernah cache konten review.

**Kontribusi user** lewat form "tambahkan tempat" dengan antrean moderasi
adalah sumber jangka panjang terbaik, tapi jangan diandalkan di awal — belum
ada usernya.

**Kurasi manual** untuk 50–100 tempat teratas di sekitar kampus. Ini yang
paling membosankan dan paling menentukan.

## Catatan: area

Data seed proyek ini seluruhnya **Jatinangor**, bukan sekitar ITB Ganesha
seperti asumsi di spec produksi. `--area=jatinangor` karena itu jadi default.
Preset `ganesha` tersedia kalau target areanya nanti diputuskan pindah — tapi
memutuskannya sebelum kurasi dimulai jauh lebih murah daripada sesudahnya.
