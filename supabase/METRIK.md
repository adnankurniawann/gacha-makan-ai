# Metrik — Fase E

**Tidak ada panel admin.** Supabase Studio sudah panel admin yang bagus, dan
membangun sendiri berarti merawat halaman yang cuma dilihat lima orang.
Jalankan kueri di bawah dari SQL Editor.

Catatan: SQL Editor berjalan sebagai `postgres`, jadi ia melihat semua baris.
Dari aplikasi dengan akun biasa, RLS membatasi ke baris sendiri.

## Satu angka yang menentukan

**Berapa persen yang spin lagi di hari berikutnya.**

```sql
select
  cohort_date,
  users,
  returned_d1,
  round(100.0 * returned_d1 / nullif(users, 0), 1) as d1_pct,
  round(100.0 * returned_d7 / nullif(users, 0), 1) as d7_pct
from retention_by_cohort
order by cohort_date desc
limit 14;
```

**Kalau D1 di bawah 20%, jangan tambah fitur.** Cari tahu kenapa orang tidak
kembali. Menambah fitur di atas produk yang orang tidak mau buka dua kali cuma
menambah hal yang tidak dipakai.

Kohort dihitung dari hari pertama seseorang memakai aplikasi, bukan hari
mendaftar — sebagian besar pengguna anonim dan tidak pernah mendaftar. Kohort
hari ini sengaja tidak muncul: ia belum punya "besok".

## Sisanya

### Accept rate

```sql
select
  count(*) filter (where effective_action = 'accepted') as diterima,
  count(*) as total,
  round(100.0 * count(*) filter (where effective_action = 'accepted')
        / nullif(count(*), 0), 1) as accept_pct
from spin_events_labeled
where not is_pending
  and shown_at > now() - interval '7 days';
```

Jelek berarti kualitas rekomendasi atau kualitas data. `not is_pending` penting:
penayangan yang jendela responsnya belum habis belum boleh dihitung sebagai
penolakan.

### Spin per sesi

```sql
select
  spins,
  count(*) as sesi,
  count(*) filter (where converted) as sesi_yang_berhasil
from session_summary
group by spins
order by spins;
```

**Intuisinya terbalik.** Sepuluh spin berturut-turut tanpa satu pun diterima
itu sinyal **buruk** — hasilnya tidak pernah pas — bukan tanda engagement
tinggi. Yang dicari: banyak sesi dengan 1–3 spin lalu `converted = true`.

### Kandidat kosong per radius

```sql
select
  radius_m,
  count(*) as kejadian,
  count(*) filter (where widening_helps) as radius_kurang_lebar,
  count(*) filter (where budget_helps)   as budget_kurang,
  count(*) filter (where closed_only)    as semua_tutup,
  count(*) filter (where not coalesce(widening_helps, false)
                     and not coalesce(budget_helps, false)
                     and not coalesce(closed_only, false)) as memang_kosong
from spin_misses
where occurred_at > now() - interval '30 days'
group by radius_m
order by kejadian desc;
```

Kolom `memang_kosong` yang paling penting: itu lubang cakupan data yang nyata,
dan tidak ada filter yang bisa menutupinya. Perbaikannya di Fase B — kurasi
lebih banyak tempat, terutama harganya.

Orang yang mengalami ini kemungkinan besar tidak kembali, jadi angkanya
biasanya lebih menyakitkan daripada kelihatannya.

### p95 latensi spin

```sql
select
  percentile_cont(0.50) within group (order by latency_ms) as p50,
  percentile_cont(0.95) within group (order by latency_ms) as p95,
  max(latency_ms) as terburuk
from spin_events
where latency_ms is not null
  and shown_at > now() - interval '7 days';
```

Ini masalah performa yang tidak akan terasa di laptop kalian. Angkanya diukur
dari sisi server saja — waktu yang dirasakan pengguna di 4G goyah lebih besar
dari ini.

### Cakupan katalog

```sql
select
  count(distinct restaurant_id) as pernah_tayang,
  (select count(*) from restaurants where is_active) as total_aktif
from spin_events
where shown_at > now() - interval '30 days';
```

Sistem yang cuma merekomendasikan lima tempat teratas itu gagal sebagai produk,
walau accept rate-nya tinggi.

## Sebelum menyebar link

Ini yang membuat Fase E punya urutan: **kolom yang tidak dicatat sekarang
hilang selamanya.** Tidak ada cara menambahkan kolom ke peristiwa yang sudah
terjadi.

- [ ] Migrasi Fase A–E dijalankan semua
- [ ] Anonymous sign-ins aktif — tanpa ini **nol baris** tercatat
- [ ] `pg_cron` aktif dan `mark_ignored_spins()` terjadwal
- [ ] Cek `select count(*) from spin_events` naik setelah kamu spin sendiri
- [ ] Cek `policy_score` terisi, bukan null

Poin terakhir yang paling mudah terlewat dan paling mahal — lihat bagian
berikutnya.

## Kenapa `policy_score` penting

Roadmap ML bertumpu pada satu asumsi: log dikumpulkan di bawah kebijakan acak
**seragam**, sehingga evaluasi replay memberi estimasi tak bias.

**Untuk aplikasi ini asumsi itu tidak berlaku.** Pemilihan di
`src/utils/gacha.ts` berbobot terhadap selisih budget — dengan budget Rp20.000,
tempat Rp5.000 punya peluang 75% dan tempat Rp15.000 punya 25%. Bukan 50/50.

Menyimpan peluang aktual tiap penayangan menyelamatkan keadaan: evaluasi nanti
bisa membagi biasnya kembali (*inverse propensity scoring*) alih-alih diam-diam
mewarisi bias yang tidak diperhitungkan siapa pun.

Tanpa kolom itu, satu-satunya pilihan jujur nanti adalah membuang lognya, atau
menerbitkan angka yang salah ke arah yang bahkan tidak bisa ditaksir besarnya.

## Melaporkan hasil dengan jujur

Untuk mendeteksi kenaikan accept rate dari 20% ke 25% dengan daya statistik
wajar, dibutuhkan sekitar **1.000+ spin per grup**. Sebagai proyek kuliah
dengan pengguna teman sendiri, kemungkinan besar angkanya tidak akan sampai ke
sana — dan itu tidak apa-apa.

Yang harus dilakukan adalah melaporkan apa adanya:

> n=180, selisih +4.2pp, CI 95% [-3.1, +11.5], tidak signifikan.

Menulis "meningkatkan akurasi 23%" dari 40 sampel akan hancur begitu ditanya
soal signifikansi. Interval kepercayaan yang melewati nol, ditambah penjelasan
kenapa, terbaca sebagai orang yang bisa dipercaya memegang data. Yang kedua
jauh lebih jarang.
