-- ==========================================================================
-- Tempat tanpa harga ikut muncul di spin
--
-- Ingest OpenStreetMap mengisi price_tier dengan null: OSM praktis tidak
-- pernah punya harga, dan menebaknya berarti membohongi filter budget. Tapi
-- `null <= budget` di Postgres bukan true, jadi selama ini baris seperti itu
-- tidak pernah muncul — 1.870 tempat Bandung akan masuk katalog dan tidak
-- terlihat sama sekali.
--
-- Sekarang tempat tanpa harga ikut jadi kandidat, ditampilkan sebagai "harga
-- belum diketahui". Harganya tetap null, tidak diganti tebakan. Bobot undian
-- untuk tempat seperti itu ditentukan di aplikasi (`calculateSpinWeights`,
-- kebijakan `weighted_budget_v2`), bukan di sini.
--
-- Tanda tangan dan tipe kembalian sama dengan versi sebelumnya, jadi
-- `create or replace` cukup. Idempoten.
-- ==========================================================================

begin;

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
    -- Harga yang belum diketahui bukan berarti di atas budget. Yang PASTI di
    -- atas budget tetap disingkirkan.
    and (r.price_tier is null or r.price_tier <= budget)
    and ST_Distance(r.location, here.point) <= radius_meters
    -- `is not false` menyingkirkan yang PASTI tutup, tapi tetap memunculkan
    -- yang jam bukanya belum terdata. Selama kurasi belum selesai, membuang
    -- keduanya sama saja dengan mengosongkan aplikasi.
    and (not only_open or status.is_open is not false)
  order by distance asc, price_tier asc nulls last, hygiene_score desc, name asc;
$$;

revoke all on function public.get_eligible_restaurants(
  integer, integer, double precision, double precision, boolean
) from public;
grant execute on function public.get_eligible_restaurants(
  integer, integer, double precision, double precision, boolean
) to anon, authenticated;

commit;
