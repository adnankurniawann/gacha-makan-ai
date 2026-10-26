-- ============================================================================
-- Fase A1 — Row Level Security hardening
--
-- Jalankan SEKALI di Supabase SQL Editor (project beajhxnqlrfmxgtuhieg).
-- Setelah itu jalankan `node scripts/verify-rls.mjs` untuk membuktikan
-- kebijakannya benar-benar berlaku, bukan cuma diasumsikan.
--
-- Prinsip: anon key ada di bundle frontend, jadi anggap SEMUA orang punya
-- key itu. Yang boleh dilakukan pemegang anon key = yang boleh dilakukan
-- penyerang. Hak akses diberikan seminimal mungkin, mutasi data dilakukan
-- lewat fungsi security definer yang aturannya dipaksakan di sisi database.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Aktifkan RLS di semua tabel public
--    `users` dan `user_history` sebelumnya TIDAK punya RLS sama sekali.
--    Tanpa RLS, grant bawaan Supabase (anon/authenticated dapat ALL) membuat
--    kedua tabel itu bisa dibaca, ditulis, dan dihapus siapa pun.
-- ---------------------------------------------------------------------------
alter table public.users            enable row level security;
alter table public.restaurants      enable row level security;
alter table public.hygiene_reports  enable row level security;
alter table public.user_history     enable row level security;
alter table public.wallets          enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Cabut grant bawaan, lalu berikan kembali seperlunya.
--    RLS saja tidak cukup: policy hanya dievaluasi kalau role-nya memang
--    punya privilege tabel. Mencabut grant = lapisan pertahanan kedua yang
--    tetap berlaku andai ada policy yang keliru di kemudian hari.
-- ---------------------------------------------------------------------------
revoke all on public.users           from anon, authenticated;
revoke all on public.restaurants     from anon, authenticated;
revoke all on public.hygiene_reports from anon, authenticated;
revoke all on public.user_history    from anon, authenticated;
revoke all on public.wallets         from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. restaurants — katalog publik: boleh dibaca, TIDAK boleh ditulis
--
--    Lubang paling parah sebelum migrasi ini: policy
--    `restaurants_update_public` dengan using(true)/with check(true).
--    Siapa pun yang membuka DevTools bisa mengubah nama, harga, koordinat,
--    dan hygiene_score warung mana pun — termasuk menaikkan skor warung
--    yang sudah di-flag kotor.
-- ---------------------------------------------------------------------------
drop policy if exists restaurants_update_public on public.restaurants;
drop policy if exists restaurants_select_public on public.restaurants;

create policy restaurants_select_public
  on public.restaurants
  for select
  to anon, authenticated
  using (true);

grant select on public.restaurants to anon, authenticated;
-- Tidak ada grant insert/update/delete. Perubahan hygiene_score hanya lewat
-- submit_hygiene_report() di bagian 4.

-- ---------------------------------------------------------------------------
-- 4. hygiene_reports — laporan boleh dibaca publik, KECUALI kolom identitas
--
--    Sebelum migrasi ini `hygiene_reports_select_public` membuka seluruh
--    baris termasuk `reporter_ip`. Alamat IP pelapor adalah data pribadi dan
--    tidak boleh terbaca siapa pun yang punya anon key.
--
--    RLS bekerja per-baris, bukan per-kolom. Jadi pembatasan kolom dilakukan
--    dengan column-level GRANT: reporter_ip dan user_id tidak ikut diberikan.
-- ---------------------------------------------------------------------------
drop policy if exists hygiene_reports_select_public on public.hygiene_reports;
drop policy if exists hygiene_reports_insert_public on public.hygiene_reports;

create policy hygiene_reports_select_public
  on public.hygiene_reports
  for select
  to anon, authenticated
  using (true);

grant select (id, restaurant_id, report_type, description, created_at)
  on public.hygiene_reports to anon, authenticated;
-- Sengaja TIDAK diberikan: reporter_ip, user_id.
-- Konsekuensi: `select=*` pada tabel ini sekarang ditolak database.
-- Query aplikasi harus menyebut kolom secara eksplisit (sudah demikian).

-- Tidak ada grant insert. Penulisan laporan hanya lewat fungsi di bawah,
-- supaya cooldown dan perubahan skor tidak bisa dilewati dari klien.

-- ---------------------------------------------------------------------------
-- 4a. submit_hygiene_report — satu-satunya jalan menulis laporan
--
--     Menggabungkan: validasi, cek cooldown, insert laporan, dan update
--     hygiene_score dalam satu transaksi. Karena security definer, fungsi ini
--     berjalan dengan hak pemiliknya, jadi anon tidak perlu (dan tidak punya)
--     hak tulis langsung ke tabel mana pun.
--
--     IP diambil dari header request di sisi database, bukan dari parameter,
--     supaya pemanggil tidak bisa memilih IP-nya sendiri lewat API.
--     Catatan jujur: x-forwarded-for tetap bisa dimanipulasi. Cooldown ini
--     menahan spam iseng, bukan penyerang yang serius. Pertahanan sebenarnya
--     terhadap manipulasi skor adalah hilangnya hak UPDATE di bagian 3.
-- ---------------------------------------------------------------------------
create or replace function public.submit_hygiene_report(
  p_restaurant_id uuid,
  p_report_type   text,
  p_description   text default null
)
returns public.restaurants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ip         text;
  v_user_id    uuid;
  v_new_score  int;
  v_restaurant public.restaurants;
begin
  if p_report_type is null or p_report_type not in ('RED_FLAG', 'CLEAN') then
    raise exception 'INVALID_REPORT_TYPE' using errcode = 'PT400';
  end if;

  if p_description is not null and char_length(p_description) > 1000 then
    raise exception 'DESCRIPTION_TOO_LONG' using errcode = 'PT400';
  end if;

  select * into v_restaurant
    from public.restaurants
   where id = p_restaurant_id;

  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'PT404';
  end if;

  -- IP pemanggil, diambil dari header yang diteruskan PostgREST.
  v_ip := nullif(
    btrim(
      split_part(
        coalesce(
          current_setting('request.headers', true)::json ->> 'x-forwarded-for',
          ''
        ),
        ',',
        1
      )
    ),
    ''
  );
  v_ip := coalesce(v_ip, 'unknown');

  perform 1
     from public.hygiene_reports
    where restaurant_id = p_restaurant_id
      and reporter_ip   = v_ip
      and created_at    > now() - interval '24 hours'
    limit 1;

  if found then
    raise exception 'COOLDOWN_ACTIVE' using errcode = 'PT429';
  end if;

  -- hygiene_reports.user_id punya FK ke public.users, yang belum tentu terisi
  -- untuk setiap akun auth. Simpan null kalau barisnya belum ada, supaya
  -- laporan tidak gagal hanya karena profil belum dibuat.
  v_user_id := auth.uid();
  if v_user_id is not null
     and not exists (select 1 from public.users where id = v_user_id) then
    v_user_id := null;
  end if;

  insert into public.hygiene_reports
    (user_id, restaurant_id, report_type, description, reporter_ip)
  values
    (v_user_id, p_restaurant_id, p_report_type, p_description, v_ip);

  v_new_score := case
    when p_report_type = 'RED_FLAG' then greatest(0,   v_restaurant.hygiene_score - 50)
    else                                 least(100, v_restaurant.hygiene_score + 20)
  end;

  update public.restaurants
     set hygiene_score    = v_new_score,
         -- Skor naik tidak otomatis memulihkan status terverifikasi.
         is_verified_safe = case when v_new_score < 50 then false
                                 else is_verified_safe end
   where id = p_restaurant_id
  returning * into v_restaurant;

  return v_restaurant;
end;
$$;

revoke all on function public.submit_hygiene_report(uuid, text, text) from public;
grant execute on function public.submit_hygiene_report(uuid, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. users — hanya pemilik baris
-- ---------------------------------------------------------------------------
drop policy if exists users_select_own on public.users;
drop policy if exists users_insert_own on public.users;
drop policy if exists users_update_own on public.users;

create policy users_select_own
  on public.users for select
  to authenticated
  using (auth.uid() = id);

create policy users_insert_own
  on public.users for insert
  to authenticated
  with check (auth.uid() = id);

create policy users_update_own
  on public.users for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

grant select, insert, update on public.users to authenticated;
-- Tidak ada policy/grant delete: profil tidak bisa dihapus lewat API publik.

-- ---------------------------------------------------------------------------
-- 6. user_history — riwayat hanya milik pemiliknya, dan tidak bisa diubah
--    Ini calon sumber data model rekomendasi (Fase D). Histori yang bisa
--    diedit belakangan = data latih yang tidak sah.
-- ---------------------------------------------------------------------------
drop policy if exists user_history_select_own on public.user_history;
drop policy if exists user_history_insert_own on public.user_history;

create policy user_history_select_own
  on public.user_history for select
  to authenticated
  using (auth.uid() = user_id);

create policy user_history_insert_own
  on public.user_history for insert
  to authenticated
  with check (auth.uid() = user_id);

grant select, insert on public.user_history to authenticated;
-- Tidak ada update/delete sama sekali: histori bersifat append-only.

-- ---------------------------------------------------------------------------
-- 7. wallets — policy lama sudah benar, dirapikan dan diberi nama konsisten
-- ---------------------------------------------------------------------------
drop policy if exists "User can view own wallet"   on public.wallets;
drop policy if exists "User can update own wallet" on public.wallets;
drop policy if exists "User can insert own wallet" on public.wallets;
drop policy if exists wallets_select_own on public.wallets;
drop policy if exists wallets_insert_own on public.wallets;
drop policy if exists wallets_update_own on public.wallets;

create policy wallets_select_own
  on public.wallets for select
  to authenticated
  using (auth.uid() = user_id);

create policy wallets_insert_own
  on public.wallets for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy wallets_update_own
  on public.wallets for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.wallets to authenticated;
-- Tidak ada delete.

-- ---------------------------------------------------------------------------
-- 8. Kunci search_path fungsi lama
--    Fungsi tanpa search_path tetap bisa dibajak lewat objek bernama sama di
--    schema lain yang kebetulan lebih dulu di search_path pemanggil.
-- ---------------------------------------------------------------------------
alter function public.get_eligible_restaurants(integer, integer, double precision, double precision)
  set search_path = public, pg_temp;

commit;
