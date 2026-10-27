-- ==========================================================================
-- Skor kebersihan "belum dinilai" = null, bukan 100
--
-- Ingest OSM dan default kolom mengisi hygiene_score = 100 untuk setiap
-- tempat baru. Akibatnya 1.872 dari 1.902 tempat tampil "100" padahal belum
-- pernah ada satu laporan pun — angka itu terbaca sebagai "terverifikasi
-- bersih". Sekarang tempat tanpa laporan bernilai null dan UI menyebutnya
-- "belum ada laporan", sama seperti price_tier yang null = "harga belum
-- diketahui".
--
-- Skor tetap hanya berubah lewat submit_hygiene_report(). Laporan pertama
-- dihitung dari titik awal 100 seperti sebelumnya, jadi aturan +20 / -50
-- tidak berubah.
--
-- Tanda tangan fungsi sama dengan versi sebelumnya, jadi `create or replace`
-- cukup. Idempoten.
-- ==========================================================================

begin;

alter table public.restaurants alter column hygiene_score drop default;

-- Hanya 100 bawaan yang dibersihkan: yang sudah punya laporan atau ditandai
-- aman secara manual tetap memegang skornya.
update public.restaurants r
   set hygiene_score = null
 where r.hygiene_score = 100
   and not r.is_verified_safe
   and not exists (
     select 1 from public.hygiene_reports h where h.restaurant_id = r.id
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
    -- Belum ada laporan bukan berarti kotor. Yang PASTI dilaporkan buruk
    -- tetap disingkirkan.
    and (r.hygiene_score is null or r.hygiene_score >= 50)
    -- Harga yang belum diketahui bukan berarti di atas budget. Yang PASTI di
    -- atas budget tetap disingkirkan.
    and (r.price_tier is null or r.price_tier <= budget)
    and ST_Distance(r.location, here.point) <= radius_meters
    -- `is not false` menyingkirkan yang PASTI tutup, tapi tetap memunculkan
    -- yang jam bukanya belum terdata. Selama kurasi belum selesai, membuang
    -- keduanya sama saja dengan mengosongkan aplikasi.
    and (not only_open or status.is_open is not false)
  order by distance asc, price_tier asc nulls last, hygiene_score desc nulls last, name asc;
$$;

revoke all on function public.get_eligible_restaurants(
  integer, integer, double precision, double precision, boolean
) from public;
grant execute on function public.get_eligible_restaurants(
  integer, integer, double precision, double precision, boolean
) to anon, authenticated;

-- Sama dengan versi di 20260804000001_rls_hardening.sql, kecuali skor null
-- dihitung dari 100.
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
    when p_report_type = 'RED_FLAG' then greatest(0,   coalesce(v_restaurant.hygiene_score, 100) - 50)
    else                                 least(100, coalesce(v_restaurant.hygiene_score, 100) + 20)
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

commit;
