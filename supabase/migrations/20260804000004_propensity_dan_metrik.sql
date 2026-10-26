-- ============================================================================
-- Fase E — kesiapan data sebelum trafik datang
--
-- Jalankan di Supabase SQL Editor SETELAH migrasi Fase D.
--
-- Fase E soal distribusi, dan distribusi berarti data mulai mengalir sungguhan.
-- Yang tidak dicatat sekarang hilang selamanya: tidak ada cara menambahkan
-- kolom ke peristiwa yang sudah lewat. Jadi kolom-kolom ini harus ada SEBELUM
-- link disebar, bukan sesudah.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. policy_score — peluang kebijakan memilih baris ini
--
--    Roadmap ML bertumpu pada satu asumsi: log dikumpulkan di bawah kebijakan
--    acak SERAGAM, sehingga replay memberi estimasi tak bias. Untuk aplikasi
--    ini asumsi itu TIDAK berlaku — pemilihannya berbobot terhadap selisih
--    budget, jadi tempat murah muncul lebih sering.
--
--    Menyimpan peluang aktual tiap penayangan menyelamatkan keadaan: evaluasi
--    nanti bisa membagi biasnya kembali (inverse propensity scoring) alih-alih
--    diam-diam mewarisi bias yang tidak diperhitungkan siapa pun.
--
--    Tanpa kolom ini, satu-satunya pilihan jujur nanti adalah membuang lognya,
--    atau menerbitkan angka yang salah ke arah yang bahkan tidak bisa ditaksir.
-- ---------------------------------------------------------------------------
alter table public.spin_events
  add column if not exists policy_score double precision,
  add column if not exists latency_ms   integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'spin_events_policy_score_range'
  ) then
    alter table public.spin_events
      add constraint spin_events_policy_score_range
      check (policy_score is null or (policy_score > 0 and policy_score <= 1));
  end if;
end $$;

comment on column public.spin_events.policy_score is
  'Peluang kebijakan memilih restoran ini dari kandidat yang ada saat itu. '
  'Wajib untuk evaluasi off-policy yang tak bias. Null hanya untuk baris '
  'yang tercatat sebelum kolom ini ada.';

comment on column public.spin_events.latency_ms is
  'Lama /api/spin memproses permintaan ini, untuk metrik p95.';

-- ---------------------------------------------------------------------------
-- 2. spin_misses — spin yang tidak menghasilkan apa-apa
--
--    spin_events hanya mencatat saat ada yang DITAYANGKAN. Spin yang berakhir
--    tanpa kandidat tidak meninggalkan jejak sama sekali, padahal itu justru
--    kegagalan yang paling penting diketahui: ia menandai lubang cakupan data
--    di radius tertentu, dan orang yang mengalaminya kemungkinan besar tidak
--    kembali.
--
--    Tabel terpisah, bukan baris spin_events dengan restaurant_id null, supaya
--    tidak ada kueri analisis yang tanpa sadar mencampur "ditayangkan lalu
--    ditolak" dengan "tidak ada yang bisa ditayangkan".
-- ---------------------------------------------------------------------------
create table if not exists public.spin_misses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  session_id  uuid not null,
  occurred_at timestamptz not null default now(),

  user_lat    double precision not null,
  user_lng    double precision not null,
  radius_m    integer not null,
  budget      integer not null,
  only_open   boolean not null,

  -- Hasil diagnosa server: apa yang sebenarnya menyaring habis kandidatnya.
  -- Menjawab "perlu data lebih banyak" vs "filternya terlalu ketat" tanpa
  -- perlu menebak.
  widening_helps boolean,
  budget_helps   boolean,
  closed_only    boolean
);

create index if not exists spin_misses_occurred_idx
  on public.spin_misses (occurred_at desc);

alter table public.spin_misses enable row level security;

revoke all on public.spin_misses from anon, authenticated;

drop policy if exists spin_misses_insert_own on public.spin_misses;
drop policy if exists spin_misses_select_own on public.spin_misses;

create policy spin_misses_insert_own
  on public.spin_misses for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy spin_misses_select_own
  on public.spin_misses for select
  to authenticated
  using (auth.uid() = user_id);

grant select, insert on public.spin_misses to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Metrik
--
--    Tidak ada panel admin. Supabase Studio sudah panel admin yang bagus, dan
--    membangun sendiri berarti merawat halaman yang cuma dilihat lima orang.
--    View ini dipakai dari SQL Editor — lihat supabase/METRIK.md.
--
--    View memakai security_invoker, jadi anggota tim melihat lewat RLS: dengan
--    akun biasa yang terlihat hanya baris sendiri. Untuk angka seluruh
--    pengguna, jalankan dari SQL Editor (yang berjalan sebagai postgres).
-- ---------------------------------------------------------------------------

-- Hari aktif per pengguna, dalam waktu lokal. Dasar semua angka retensi.
create or replace view public.user_active_days
with (security_invoker = true) as
select distinct
  user_id,
  (shown_at at time zone 'Asia/Jakarta')::date as active_date
from public.spin_events;

/**
 * Retensi D1 dan D7 per hari kohort.
 *
 * SATU angka yang paling menentukan di Fase E: berapa persen yang spin lagi
 * di hari berikutnya. Kalau di bawah 20%, jangan tambah fitur — cari tahu
 * kenapa orang tidak kembali.
 *
 * Kohort = hari pertama seseorang memakai aplikasi, bukan hari mereka
 * mendaftar. Sebagian besar pengguna anonim dan tidak pernah mendaftar.
 */
create or replace view public.retention_by_cohort
with (security_invoker = true) as
with first_day as (
  select user_id, min(active_date) as cohort_date
    from public.user_active_days
   group by user_id
)
select
  f.cohort_date,
  count(*) as users,
  count(*) filter (
    where exists (
      select 1 from public.user_active_days d
       where d.user_id = f.user_id
         and d.active_date = f.cohort_date + 1
    )
  ) as returned_d1,
  count(*) filter (
    where exists (
      select 1 from public.user_active_days d
       where d.user_id = f.user_id
         and d.active_date = f.cohort_date + 7
    )
  ) as returned_d7
from first_day f
-- Kohort hari ini belum punya "besok", jadi angkanya belum berarti apa-apa.
where f.cohort_date < (now() at time zone 'Asia/Jakarta')::date
group by f.cohort_date
order by f.cohort_date desc;

/**
 * Ringkasan per sesi.
 *
 * Perhatikan `spins`: intuisinya terbalik. Sepuluh spin berturut-turut tanpa
 * satu pun diterima itu sinyal BURUK — hasilnya tidak pernah pas — bukan tanda
 * engagement tinggi.
 */
create or replace view public.session_summary
with (security_invoker = true) as
select
  e.session_id,
  e.user_id,
  min(e.shown_at) as started_at,
  count(*) as spins,
  count(*) filter (where l.effective_action = 'accepted') as accepted,
  bool_or(l.effective_action = 'accepted') as converted
from public.spin_events e
join public.spin_events_labeled l on l.id = e.id
group by e.session_id, e.user_id;

grant select on public.user_active_days     to authenticated;
grant select on public.retention_by_cohort  to authenticated;
grant select on public.session_summary      to authenticated;

commit;
