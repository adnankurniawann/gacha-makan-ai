-- ============================================================================
-- Fase B — jam buka, kualitas data, dan filter "buka sekarang"
--
-- Jalankan di Supabase SQL Editor SETELAH 20260804000001_rls_hardening.sql.
--
-- Aplikasi rekomendasi restoran nilainya sama dengan kualitas basis datanya.
-- Merekomendasikan tempat yang tutup jam 11 malam menghancurkan kepercayaan
-- lebih cepat daripada rekomendasi yang kurang pas.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Kolom kualitas dan asal-usul data di restaurants
--
--    `osm_id` membuat ingest ulang bersifat idempoten: baris yang sama dari
--    OpenStreetMap tidak akan masuk dua kali walau skripnya dijalankan
--    berkali-kali.
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists photo_url        text,
  add column if not exists address          text,
  add column if not exists is_active        boolean not null default true,
  add column if not exists osm_id           text,
  add column if not exists data_source      text not null default 'seed',
  add column if not exists last_verified_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'restaurants_data_source_check'
  ) then
    alter table public.restaurants
      add constraint restaurants_data_source_check
      check (data_source in ('seed', 'osm', 'manual', 'user'));
  end if;
end $$;

-- Satu baris OSM = satu baris di sini. Null diperbolehkan berkali-kali
-- (data seed dan kurasi manual tidak punya osm_id).
create unique index if not exists restaurants_osm_id_key
  on public.restaurants (osm_id)
  where osm_id is not null;

-- Warung tutup permanen ditandai is_active = false, bukan dihapus: menghapus
-- baris akan memutus foreign key di hygiene_reports dan user_history, dan
-- membuang riwayat yang nanti dipakai model rekomendasi.
create index if not exists restaurants_active_idx
  on public.restaurants (is_active)
  where is_active;

-- ---------------------------------------------------------------------------
-- 2. Jam buka
--
--    Satu baris per (restoran, hari, jam mulai). Baris ganda pada hari yang
--    sama dipakai untuk warung yang tutup siang lalu buka lagi sore.
--
--    day_of_week mengikuti konvensi Postgres `extract(dow)` dan JavaScript
--    `Date.getDay()`: 0 = Minggu, 6 = Sabtu. Sama di database dan di frontend,
--    jadi tidak ada konversi yang bisa salah di tengah jalan.
-- ---------------------------------------------------------------------------
create table if not exists public.opening_hours (
  restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
  day_of_week      smallint not null check (day_of_week between 0 and 6),
  opens_at         time not null,
  closes_at        time not null,
  -- Warung yang tutup jam 2 pagi. Bukan turunan otomatis karena '24:00' juga
  -- lebih besar dari opens_at, tapi itu tutup tengah malam pas — bukan lewat.
  crosses_midnight boolean not null default false,

  primary key (restaurant_id, day_of_week, opens_at),

  -- Kalau jam tutup tidak lebih besar dari jam buka, satu-satunya tafsir yang
  -- masuk akal adalah ia melewati tengah malam. Constraint ini mencegah baris
  -- seperti 18:00-02:00 tersimpan tanpa flag dan diam-diam tidak pernah cocok.
  constraint opening_hours_midnight_consistency
    check (crosses_midnight = (closes_at <= opens_at))
);

create index if not exists opening_hours_restaurant_day_idx
  on public.opening_hours (restaurant_id, day_of_week);

comment on table public.opening_hours is
  'Jam buka per hari. Buka 24 jam ditulis 00:00:00-24:00:00. '
  'Tidak adanya baris sama sekali berarti jam bukanya BELUM TERDATA, '
  'bukan berarti tutup — lihat is_open_now().';

-- ---------------------------------------------------------------------------
-- 3. is_open_now
--
--    Mengembalikan NULL kalau jam bukanya belum terdata. Ini disengaja dan
--    penting: dengan tiga nilai (buka / tutup / belum tahu), pemanggil bisa
--    memilih menyembunyikan yang PASTI tutup tanpa ikut menyembunyikan yang
--    belum sempat dikurasi. Kalau fungsi ini mengembalikan false untuk data
--    kosong, hari ini seluruh katalog akan hilang dari hasil pencarian.
-- ---------------------------------------------------------------------------
create or replace function public.is_open_now(
  p_restaurant_id uuid,
  p_at            timestamptz default now()
)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_local     timestamp;
  v_time      time;
  v_day       smallint;
  v_prev_day  smallint;
begin
  if not exists (
    select 1 from public.opening_hours where restaurant_id = p_restaurant_id
  ) then
    return null;  -- belum terdata
  end if;

  -- Semua jam buka disimpan dalam waktu lokal warung, bukan UTC.
  v_local    := p_at at time zone 'Asia/Jakarta';
  v_time     := v_local::time;
  v_day      := extract(dow from v_local)::smallint;
  v_prev_day := (v_day + 6) % 7;

  return exists (
    select 1
      from public.opening_hours oh
     where oh.restaurant_id = p_restaurant_id
       and (
         -- Jadwal normal hari ini.
         (oh.day_of_week = v_day
          and not oh.crosses_midnight
          and v_time >= oh.opens_at
          and v_time <  oh.closes_at)

         -- Hari ini, sebelum tengah malam, untuk jadwal yang menyeberang.
         or (oh.day_of_week = v_day
             and oh.crosses_midnight
             and v_time >= oh.opens_at)

         -- Sisa jadwal kemarin yang menyeberang ke dini hari ini.
         or (oh.day_of_week = v_prev_day
             and oh.crosses_midnight
             and v_time < oh.closes_at)
       )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS untuk opening_hours — sejalan dengan Fase A
--    Publik boleh baca, klien tidak boleh menulis apa pun.
-- ---------------------------------------------------------------------------
alter table public.opening_hours enable row level security;

revoke all on public.opening_hours from anon, authenticated;

drop policy if exists opening_hours_select_public on public.opening_hours;
create policy opening_hours_select_public
  on public.opening_hours
  for select
  to anon, authenticated
  using (true);

grant select on public.opening_hours to anon, authenticated;

revoke all on function public.is_open_now(uuid, timestamptz) from public;
grant execute on function public.is_open_now(uuid, timestamptz)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Antrean kurasi
--
--    Daftar apa yang kurang dari tiap baris, supaya pengisian manual bisa
--    dikerjakan dari yang paling berdampak. Target Fase B adalah 200-300
--    tempat dengan data LENGKAP; 2.000 tempat setengah jadi lebih buruk.
-- ---------------------------------------------------------------------------
create or replace view public.restaurant_curation_queue
with (security_invoker = true) as
select
  r.id,
  r.name,
  r.data_source,
  r.last_verified_at,
  array_remove(array[
    case when r.category   is null or btrim(r.category) = '' then 'kategori'  end,
    case when r.price_tier is null or r.price_tier <= 0      then 'harga'     end,
    case when r.photo_url  is null or btrim(r.photo_url) = '' then 'foto'     end,
    case when r.address    is null or btrim(r.address) = ''   then 'alamat'   end,
    case when not exists (
      select 1 from public.opening_hours oh where oh.restaurant_id = r.id
    ) then 'jam_buka' end
  ], null) as missing_fields
from public.restaurants r
where r.is_active;

grant select on public.restaurant_curation_queue to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Pencarian radius: default hanya yang sedang buka
--
--    Tanda tangan lama (4 argumen) dibuang supaya tidak ada pemanggil yang
--    diam-diam memakai versi tanpa filter jam buka.
-- ---------------------------------------------------------------------------
drop function if exists public.get_eligible_restaurants(
  integer, integer, double precision, double precision
);

create or replace function public.get_eligible_restaurants(
  budget        integer,
  radius_meters integer,
  user_lat      double precision,
  user_lng      double precision,
  only_open     boolean default true
)
returns table (
  id            uuid,
  name          text,
  category      text,
  price_tier    int,
  hygiene_score int,
  distance      int,
  is_open       boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  with here as (
    select st_setsrid(st_makepoint(user_lng, user_lat), 4326)::geography as point
  )
  select
    r.id,
    r.name,
    r.category,
    r.price_tier,
    r.hygiene_score,
    round(ST_Distance(r.location, here.point))::int as distance,
    status.is_open
  from public.restaurants r
  cross join here
  -- LATERAL supaya is_open_now dipanggil sekali per baris, bukan sekali di
  -- select dan sekali lagi di where.
  cross join lateral (select public.is_open_now(r.id) as is_open) status
  where r.is_active
    and r.hygiene_score >= 50
    and r.price_tier <= budget
    and ST_Distance(r.location, here.point) <= radius_meters
    -- `is not false` menyingkirkan yang PASTI tutup, tapi tetap memunculkan
    -- yang jam bukanya belum terdata. Selama kurasi belum selesai, membuang
    -- keduanya sama saja dengan mengosongkan aplikasi.
    and (not only_open or status.is_open is not false)
  order by distance asc, price_tier asc, hygiene_score desc, name asc;
$$;

revoke all on function public.get_eligible_restaurants(
  integer, integer, double precision, double precision, boolean
) from public;
grant execute on function public.get_eligible_restaurants(
  integer, integer, double precision, double precision, boolean
) to anon, authenticated;

commit;
