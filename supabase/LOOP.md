# Loop umpan balik — Fase D

`spin_events` bukan analytics. Ia data latih model rekomendasi nanti, dan itu
mengubah aturan mainnya.

## Urutan menjalankan

```bash
# Migrasi Fase A dan B dulu, lalu di Supabase SQL Editor:
#   supabase/migrations/20260804000003_spin_events_dan_favorit.sql
```

Lalu jadwalkan penanda "terabaikan" — **Database → Extensions → aktifkan
`pg_cron`**, kemudian:

```sql
select cron.schedule(
  'tandai-spin-terabaikan', '*/5 * * * *',
  $job$ select public.mark_ignored_spins(); $job$
);
```

Kalau `pg_cron` belum aktif, barisnya tetap `null` dan view
`spin_events_labeled` tetap memperlakukannya sebagai `ignored` saat analisis.
Jadi tidak ada yang rusak — cuma tabelnya belum rapi.

## Tiga aturan yang tidak boleh dilanggar

### 1. Konteks dibekukan saat penayangan

`hour_local`, `day_of_week`, `is_weekend`, dan `distance_km` disimpan sebagai
nilai, **bukan dihitung ulang dari `shown_at`** saat analisis.

Kalau dihitung ulang, kita memakai aturan zona waktu dan koordinat yang berlaku
hari ini atas peristiwa yang terjadi dulu. Fitur model jadi berbeda dari yang
benar-benar berlaku saat keputusan diambil — dan model yang dilatih dengan
informasi yang tidak dimiliki sistem pada saat itu akan terlihat bagus di
evaluasi lalu gagal di dunia nyata.

Ini juga alasan pencatatan dilakukan di server, bukan di browser: jam perangkat
pengguna tidak bisa dipercaya.

### 2. Setiap penayangan dicatat, bukan hanya yang diterima

Tidak merespons **adalah** sinyal, dan jumlahnya paling banyak. Kalau hanya
yang diterima yang tercatat, model cuma belajar dari orang yang kebetulan
menekan tombol.

| Nilai `action` | Artinya |
|---|---|
| `accepted` | Menekan "Konfirmasi Makan di Sini" |
| `saved` | Menekan "Simpan buat nanti" |
| `respun` | Spin lagi selagi hasil ini masih di layar |
| `ignored` | Lewat 5 menit tanpa respons |
| `null` | Jendela responsnya belum habis — **belum boleh dihitung apa pun** |

Bedakan `null` dari `ignored`. Menghitung penayangan yang baru 30 detik sebagai
penolakan akan membuat accept rate terlihat jatuh setiap kali ada lonjakan
trafik.

### 3. Kolom `policy` harus jujur

Spec awal menyarankan mengisi `'uniform_random'` untuk sekarang. **Itu tidak
benar untuk kode ini.** Pemilihan di `src/utils/gacha.ts` berbobot terhadap
selisih budget, jadi tempat yang lebih murah muncul lebih sering. Nilainya
karena itu `weighted_budget_v1`.

Kalau bias itu dicatat sebagai undian seragam, bandit yang dilatih di atasnya
akan menganggap bias seleksi yang tidak pernah ia lihat sebagai hasil undian
adil, lalu menyimpulkan tempat murah lebih disukai daripada kenyataannya.

**Ganti string `SPIN_POLICY` setiap kali aturan pemilihannya berubah**, supaya
baris dari perilaku lama dan baru tetap bisa dipisahkan.

## Integritas

Klien tidak punya hak `update` maupun `delete` di `spin_events`. Pengisian
`action` hanya lewat `record_spin_action()`, yang cuma menyentuh baris milik
`auth.uid()` dan hanya kalau `action`-nya masih kosong — **respons pertama yang
menang**.

Orang yang menekan "Jadi ke sini" lalu berubah pikiran tidak sedang berbohong,
tapi label reward-nya harus tetap yang pertama: itulah keputusan yang
benar-benar diambil sebagai respons atas penayangan tadi.

`mark_ignored_spins()` menulis `acted_at = shown_at + 5 menit`, bukan `now()`.
Job yang telat tiga jam tidak boleh membuat seolah pengguna berpikir tiga jam.

## Metrik

```sql
-- Accept rate, tanpa mencemari angkanya dengan penayangan yang masih menunggu
select
  count(*) filter (where effective_action = 'accepted')::numeric
    / nullif(count(*), 0) as accept_rate,
  count(*) as total
from spin_events_labeled
where not is_pending
  and shown_at > now() - interval '7 days';
```

```sql
-- Spin per sesi. Intuisinya terbalik: sepuluh spin berturut-turut tanpa satu
-- pun diterima itu sinyal BURUK, bukan tanda engagement tinggi.
select session_id, count(*) as spins,
       bool_or(effective_action = 'accepted') as ada_yang_diterima
from spin_events_labeled
group by session_id
order by spins desc
limit 20;
```

Angka yang paling penting di awal tetap satu: **berapa persen yang spin lagi di
hari berikutnya.** Kalau di bawah 20%, jangan tambah fitur — cari tahu kenapa
orang tidak kembali.

## Kartu bagikan

`/hasil/[id]` punya Open Graph image sendiri, jadi tautan yang ditempel di grup
WA atau Line muncul sebagai kartu bergambar.

Isinya dibaca dari database berdasarkan id, **bukan dari query string**. Kartu
yang teksnya bisa diisi lewat URL akan jadi alat bagus untuk memalsukan pesan
di atas merek kita, dan sekali tersebar tidak bisa ditarik.

## Fitur retensi

Cukup tiga, dan ketiganya sudah ada: riwayat spin dan daftar simpanan di
`/riwayat`, filter tersimpan di localStorage halaman spin. **Jangan tambah yang
keempat sebelum ketiganya terbukti terpakai.**
