-- ==========================================================================
-- Riwayat pengguna untuk fitur afinitas bandit
--
-- /api/spin butuh riwayat pengguna yang sedang meminta — kategori dan harga
-- yang pernah ia terima atau tolak — untuk membangun fitur afinitas saat
-- menyajikan. View ini menggabungkan label dengan katalog dalam satu query.
--
-- security_invoker, jadi RLS spin_events tetap berlaku: setiap pengguna hanya
-- melihat barisnya sendiri. Tidak ada service_role, tidak ada fungsi
-- security definer.
--
-- Idempoten.
-- ==========================================================================

begin;

create or replace view public.spin_history_for_bandit
with (security_invoker = true) as
select
  e.id,
  e.user_id,
  e.restaurant_id,
  e.shown_at,
  r.category,
  r.price_tier,
  e.distance_km,
  e.hour_local,
  e.day_of_week,
  e.is_raining,
  l.effective_action
from public.spin_events e
-- Hanya labelnya yang diambil dari spin_events_labeled, supaya aturan
-- "diabaikan setelah 5 menit" tetap didefinisikan di satu tempat. Kolom
-- lainnya dari spin_events: view itu dibuat dengan `e.*` sebelum is_raining
-- ada, dan Postgres membekukan daftar kolom `*` saat view dibuat.
join public.spin_events_labeled l on l.id = e.id
join public.restaurants r on r.id = e.restaurant_id
where l.effective_action is not null;

comment on view public.spin_history_for_bandit is
  'Riwayat berlabel milik pengguna yang meminta, untuk fitur afinitas bandit '
  'saat penyajian. Dibatasi RLS spin_events lewat security_invoker.';

revoke all on public.spin_history_for_bandit from anon;
grant select on public.spin_history_for_bandit to authenticated;

commit;
