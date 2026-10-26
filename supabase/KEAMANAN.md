# Keamanan database — Fase A

Anon key ada di bundle JavaScript yang dikirim ke browser. Siapa pun yang
membuka aplikasi bisa mengambilnya dalam sepuluh detik. Jadi patokannya satu:
**apa pun yang bisa dilakukan pemegang anon key, anggap sudah dilakukan orang
asing.** RLS-lah yang menentukan batasnya, bukan kode di frontend.

## Urutan menjalankan

```bash
# 1. schema.sql (kalau database masih kosong) — lewati kalau sudah ada isinya
# 2. seed.sql   (kalau butuh data restoran)
# 3. migrasi RLS — WAJIB, jalankan di Supabase SQL Editor:
#    supabase/migrations/20260804000001_rls_hardening.sql
# 4. buktikan:
```

```bash
node scripts/verify-rls.mjs
```

Skrip itu memakai anon key yang sama dengan frontend, lalu **mencoba** operasi
terlarang. Percobaan tulisnya dirancang tidak merusak: DELETE dan INSERT
memakai UUID acak, UPDATE menulis ulang nilai yang sama persis. Exit code 0
berarti aman.

Jangan percaya bahwa policy sudah benar hanya karena aplikasi masih jalan.
Aplikasi yang jalan cuma membuktikan jalur yang diizinkan masih terbuka — bukan
bahwa jalur yang terlarang sudah tertutup.

## Yang berubah, dan kenapa

| Sebelum | Sesudah |
|---|---|
| `users` dan `user_history` tanpa RLS sama sekali | RLS aktif, hanya pemilik baris |
| `restaurants` punya policy UPDATE `using(true)` | Tidak ada hak tulis untuk klien |
| `reporter_ip` terbaca siapa pun lewat `select *` | Kolomnya tidak di-grant ke anon |
| Cooldown laporan dicek di route handler | Dipaksakan di dalam fungsi database |

Perubahan `hygiene_score` sekarang hanya lewat `submit_hygiene_report()`, satu
fungsi `security definer` yang melakukan validasi, cek cooldown, insert, dan
update skor dalam satu transaksi. Klien tidak punya hak tulis langsung ke tabel
mana pun, jadi aturan itu tidak bisa dilewati dengan memanggil PostgREST
sendiri.

## Yang masih lemah, supaya jelas

- **Cooldown per IP tetap bisa diakali.** `x-forwarded-for` bisa dipalsukan.
  Cooldown ini menahan spam iseng, bukan penyerang serius. Pertahanan
  sebenarnya terhadap manipulasi skor adalah hilangnya hak UPDATE, bukan
  cooldown-nya.
- **Rate limit `/api/spin` dan `/api/report` disimpan di memori proses.** Di
  Vercel tiap instance punya hitungan sendiri dan reset saat cold start. Cukup
  untuk menahan satu skrip iseng menghabiskan kuota; kalau nanti perlu lebih,
  pindahkan penyimpanannya ke Redis tanpa mengubah `src/lib/rate-limit.ts`.
- **`wallets` bisa diisi sendiri oleh pemiliknya.** Ini memang desainnya —
  budget adalah alat bantu pribadi, bukan uang sungguhan.

## Kalau anon key pernah bocor

Per audit 4 Agustus 2026, tidak ada key yang pernah ter-commit ke git
(31 commit, seluruh riwayat sudah dipindai). Kalau suatu saat ada:

1. Rotasi key-nya di Supabase Dashboard → Settings → API Keys. Menghapus baris
   dari file **tidak ada gunanya** — riwayat git tetap menyimpannya.
2. Yang paling gawat adalah `service_role` key: ia melewati seluruh RLS.
   Proyek ini tidak memakainya sama sekali, dan sebaiknya tetap begitu.
3. Pindai ulang:

```bash
git log -p --all | grep -iE "service_role|SUPABASE_.*KEY|eyJhbGciOi"
```
