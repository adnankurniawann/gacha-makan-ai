-- ============================================================================
-- Fase D — loop umpan balik: spin_events dan favorites
--
-- Jalankan di Supabase SQL Editor SETELAH migrasi Fase A dan B.
--
-- Tabel ini bukan sekadar analytics. Ia adalah data latih model rekomendasi
-- nanti, dan itu mengubah aturan mainnya: konteks dibekukan saat penayangan,
-- setiap penayangan dicatat (bukan hanya yang diterima), dan tidak ada yang
-- boleh mengubah baris lama.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. spin_events
--
--    KONTEKS DIBEKUKAN SAAT PENAYANGAN. Kolom seperti hour_local dan
--    is_weekend disimpan sebagai nilai, bukan dihitung ulang dari shown_at
--    saat analisis. Alasannya bukan kenyamanan:
--
--      - Menghitung ulang berarti memakai aturan zona waktu yang berlaku HARI
--        INI atas peristiwa yang terjadi dulu.
--      - Kolom yang nanti ikut jadi fitur model harus persis sama dengan yang
--        berlaku saat keputusan diambil. Kalau tidak, model dilatih dengan
--        informasi yang tidak dimiliki sistem pada saat itu — dan hasilnya
--        terlihat bagus di evaluasi lalu gagal di dunia nyata.
--
--    distance_km juga dibekukan: koordinat warung bisa dikoreksi belakangan,
--    tapi jarak yang DIPERLIHATKAN ke pengguna saat itu tidak berubah.
-- ---------------------------------------------------------------------------
create table if not exists public.spin_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- Mengelompokkan spin dalam satu duduk. Dibuat klien, disimpan di
  -- sessionStorage, jadi menutup tab memulai sesi baru.
  session_id    uuid not null,

  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  shown_at      timestamptz not null default now(),

  user_lat      double precision not null,
  user_lng      double precision not null,
  distance_km   numeric(7,3) not null,

  -- Waktu lokal Jatinangor saat penayangan, bukan UTC.
  hour_local    smallint not null check (hour_local between 0 and 23),
  day_of_week   smallint not null check (day_of_week between 0 and 6),
  is_weekend    boolean  not null,

  -- Kebijakan yang MEMILIH hasil ini. Wajib jujur: tanpa ini, data dari dua
  -- algoritma berbeda tercampur tanpa bisa dipisahkan lagi, dan seluruh
  -- perbandingan A/B jadi tidak sah.
  policy        text not null,

  -- Berapa kandidat yang lolos filter saat itu. Satu pilihan dari 3 kandidat
  -- bukan sinyal yang sama kuat dengan satu pilihan dari 40.
  candidate_n   integer not null check (candidate_n > 0),

  action        text check (action in ('accepted', 'respun', 'saved', 'ignored')),
  acted_at      timestamptz,

  -- action dan acted_at selalu terisi bersamaan, atau sama-sama kosong.
  constraint spin_events_action_timing
    check ((action is null) = (acted_at is null))
);

create index if not exists spin_events_user_shown_idx
  on public.spin_events (user_id, shown_at desc);

create index if not exists spin_events_restaurant_idx
  on public.spin_events (restaurant_id, shown_at desc);

-- Dipakai job penanda 'ignored'; partial index karena barisnya sedikit.
create index if not exists spin_events_pending_idx
  on public.spin_events (shown_at)
  where action is null;

comment on table public.spin_events is
  'Setiap penayangan hasil spin, bukan hanya yang diterima. Konteksnya '
  'dibekukan saat penayangan dan tidak boleh dihitung ulang saat analisis.';

-- ---------------------------------------------------------------------------
-- 2. RLS — sejalan dengan Fase A
--
--    Klien boleh menulis dan membaca barisnya sendiri. TIDAK ADA hak update
--    maupun delete: histori yang bisa diedit belakangan bukan data latih yang
--    sah. Perubahan `action` hanya lewat fungsi di bagian 3.
-- ---------------------------------------------------------------------------
alter table public.spin_events enable row level security;

revoke all on public.spin_events from anon, authenticated;

drop policy if exists spin_events_insert_own on public.spin_events;
drop policy if exists spin_events_select_own on public.spin_events;

create policy spin_events_insert_own
  on public.spin_events for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy spin_events_select_own
  on public.spin_events for select
  to authenticated
  using (auth.uid() = user_id);

grant select, insert on public.spin_events to authenticated;

-- ---------------------------------------------------------------------------
-- 3. record_spin_action — satu-satunya jalan mengisi hasil
--
--    Respons pertama yang menang. Percobaan kedua diabaikan diam-diam, bukan
--    ditolak: pengguna yang menekan "Jadi ke sini" lalu berubah pikiran dan
--    menekan "Spin lagi" tidak sedang berbohong — tapi label reward-nya harus
--    tetap yang pertama, karena itulah keputusan yang benar-benar diambil
--    sebagai respons atas penayangan tadi.
-- ---------------------------------------------------------------------------
create or replace function public.record_spin_action(
  p_event_id uuid,
  p_action   text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated int;
begin
  if p_action not in ('accepted', 'respun', 'saved') then
    raise exception 'INVALID_ACTION' using errcode = 'PT400';
  end if;

  update public.spin_events
     set action   = p_action,
         acted_at = now()
   where id       = p_event_id
     and user_id  = auth.uid()   -- baris orang lain tidak terlihat, apalagi tersentuh
     and action is null;         -- respons pertama yang menang

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.record_spin_action(uuid, text) from public;
grant execute on function public.record_spin_action(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. mark_ignored_spins — penayangan tanpa respons
--
--    Tidak merespons ADALAH sinyal, dan sinyal yang paling banyak jumlahnya.
--    Kalau baris tanpa respons dibiarkan null selamanya, model hanya belajar
--    dari orang yang kebetulan menekan tombol, dan itu bias yang parah.
--
--    Sengaja TIDAK diberikan ke anon/authenticated: ini pekerjaan sistem.
--    Jadwalkan dengan pg_cron (Database -> Extensions -> aktifkan pg_cron):
--
--      select cron.schedule(
--        'tandai-spin-terabaikan', '*/5 * * * *',
--        $job$ select public.mark_ignored_spins(); $job$
--      );
--
--    Kalau pg_cron belum aktif, barisnya tetap null dan view di bagian 6
--    tetap memperlakukannya sebagai 'ignored' saat analisis.
-- ---------------------------------------------------------------------------
create or replace function public.mark_ignored_spins(
  p_older_than interval default '5 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated int;
begin
  update public.spin_events
     set action   = 'ignored',
         -- Bukan now(): yang dicatat adalah saat jendela respons habis, bukan
         -- saat job kebetulan berjalan. Job yang telat tiga jam tidak boleh
         -- membuat seolah pengguna berpikir tiga jam.
         acted_at = shown_at + p_older_than
   where action is null
     and shown_at < now() - p_older_than;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.mark_ignored_spins(interval) from public;

-- ---------------------------------------------------------------------------
-- 5. favorites
--
--    Tombol "Simpan" perlu tempat menyimpan. Berbeda dari spin_events, daftar
--    ini milik pengguna untuk diatur sendiri — jadi boleh dihapus.
-- ---------------------------------------------------------------------------
create table if not exists public.favorites (
  user_id       uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);

alter table public.favorites enable row level security;

revoke all on public.favorites from anon, authenticated;

drop policy if exists favorites_select_own on public.favorites;
drop policy if exists favorites_insert_own on public.favorites;
drop policy if exists favorites_delete_own on public.favorites;

create policy favorites_select_own
  on public.favorites for select
  to authenticated
  using (auth.uid() = user_id);

create policy favorites_insert_own
  on public.favorites for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy favorites_delete_own
  on public.favorites for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.favorites to authenticated;
-- Tidak ada update: menambah dan menghapus sudah cukup.

-- ---------------------------------------------------------------------------
-- 6. spin_events_labeled — permukaan analisis
--
--    Menutup celah antara "job belum jalan" dan "pengguna memang tidak
--    merespons". Tanpa ini, angka accept rate ikut bergantung pada apakah
--    pg_cron sempat berjalan, dan itu membuat metrik terlihat naik-turun
--    tanpa sebab yang nyata.
-- ---------------------------------------------------------------------------
create or replace view public.spin_events_labeled
with (security_invoker = true) as
select
  e.*,
  coalesce(
    e.action,
    case when e.shown_at < now() - interval '5 minutes' then 'ignored' end
  ) as effective_action,
  -- Penayangan yang jendela responsnya belum habis: belum boleh dihitung
  -- sebagai apa pun, termasuk sebagai penolakan.
  (e.action is null and e.shown_at >= now() - interval '5 minutes') as is_pending
from public.spin_events e;

grant select on public.spin_events_labeled to authenticated;

commit;
