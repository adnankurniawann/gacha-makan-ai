# Sesi dan onboarding — Fase C

Titik paling rawan kehilangan orang adalah **10 detik pertama.** Mereka datang
lapar, bukan ingin membuat akun.

## Wajib dinyalakan sebelum ini berfungsi

**Supabase Dashboard → Authentication → Providers → Anonymous sign-ins: aktif.**

Tanpa ini, `signInAnonymously()` menjawab `"Anonymous sign-ins are disabled"`.
Aplikasinya tetap jalan penuh — spin, peta, dan laporan tidak butuh login —
tapi tidak ada `user_id` yang tercatat, jadi riwayat spin kosong dan Fase D
tidak punya apa pun untuk dibangun di atasnya.

Cek dengan membuka aplikasi lalu melihat console: kalau ada peringatan
`[ensureSession]`, setelannya belum menyala.

## Anonim dulu, akun belakangan

```
Buka app → langsung bisa spin → akun baru ditawarkan kalau mau simpan riwayat
```

Sesi anonim tetap punya `user_id` sungguhan. Riwayat tercatat utuh sejak spin
pertama, dan itu yang nanti jadi data latih model rekomendasi.

Saat pengguna akhirnya memasukkan email, `AuthPanel` memakai
**`updateUser`, bukan `signInWithOtp`**. Bedanya menentukan: `updateUser`
mengaitkan email ke user yang sudah ada sehingga `user_id`-nya tidak berubah
dan riwayatnya ikut terbawa. `signInWithOtp` akan membuat user baru dan
membuang semuanya diam-diam.

Kalau ada yang mengubah baris itu nanti, tesnya akan gagal — memang sengaja.

## Izin lokasi akan ditolak, dan itu bukan kegagalan

Sebagian besar orang menolak permintaan lokasi pertama kali. Dan izin yang
sudah ditolak **tidak bisa diminta ulang** tanpa pengguna membuka setelan
browser sendiri. Satu penolakan berarti selamanya — kecuali ada jalur manual
yang setara.

`LocationPicker` karena itu:

1. **Menjelaskan dulu, baru memicu prompt.** Prompt yang muncul tiba-tiba
   hampir selalu ditolak.
2. **Membaca status izin tanpa memancing dialog**, lewat Permissions API.
   Kalau sudah ditolak, langsung ke pemilih area — tidak ada gunanya memanggil
   dialog yang pasti gagal lagi.
3. **Menyediakan pemilih area** (Kampus, Sayang, Hegarmanah, Cikeruh, Cibeusi)
   sebagai jalur setara, bukan jalur darurat.
4. **Mengingat pilihan terakhir** di localStorage, jadi pertanyaannya tidak
   diulang.

Isi localStorage tidak pernah dipercaya begitu saja: apa pun yang tidak lolos
validasi koordinat diperlakukan sebagai "belum ada pilihan". Lebih baik
bertanya sekali lagi daripada mengirim koordinat ngawur ke pencarian.

**Koordinat area itu perkiraan pusat kawasan, bukan hasil survei.** Untuk
radius 500–5000 m selisih beberapa ratus meter tidak berpengaruh berarti, tapi
verifikasi lewat peta sebelum dipakai luas.

## PWA

Manifest, service worker, dan ikon sudah terpasang. Orang bisa memasang ke
home screen, dan itu mengubah "situs yang pernah aku buka" jadi "aplikasi yang
aku punya".

Service worker-nya **sengaja konservatif**:

| Permintaan | Perlakuan |
|---|---|
| `/api/*` | Tidak pernah disentuh. Selalu jaringan. |
| Navigasi halaman | Jaringan dulu; cache hanya jaring pengaman saat offline |
| `/_next/static/*` | Cache dulu — namanya mengandung hash isi |
| Selebihnya | Lewat begitu saja |

Cache agresif di aplikasi yang datanya berubah adalah cara tercepat membuat bug
yang sulit dilacak: orang melihat warung yang sudah tutup atau skor kebersihan
yang basi, dan tidak ada tombol muat ulang yang menolong.

**Naikkan `VERSION` di `public/sw.js` setiap kali berkas itu diubah.** Nomor
itu yang memicu pembersihan cache lama.

Ikonnya SVG dengan `"sizes": "any"`. Chrome dan Android menerimanya. Kalau
nanti perlu dukungan lebih luas atau tampilan splash screen iOS yang rapi,
tambahkan PNG 192 dan 512.

## Ukuran bundle

```bash
npm run build && node scripts/bundle-size.mjs
```

Angkanya dibaca dari tag `<script>` di HTML hasil prerender — daftar berkas
yang benar-benar diminta browser saat halaman dibuka.

Dua hal yang menahan bundle awal tetap kecil, dan gampang tanpa sadar dibatalkan:

- **`m.*`, bukan `motion.*`.** `MotionProvider` memuat mesin animasi Framer
  Motion belakangan. Flag `strict` membuat `motion.*` melempar error saat
  development supaya tidak ada yang diam-diam mengembalikan bobotnya.
- **Impor dinamis untuk klien Supabase di `SessionBootstrap`.** Komponen itu
  dipasang di root layout; impor statis menyeret seluruh klien Supabase ke
  bundle awal setiap halaman, termasuk yang tidak membutuhkannya. Pernah
  terjadi sekali dan menaikkan `/map` sebesar 62 kB.
