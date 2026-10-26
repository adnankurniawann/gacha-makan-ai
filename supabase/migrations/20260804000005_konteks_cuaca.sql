-- ============================================================================
-- ML Fase 0 — melengkapi instrumentasi
--
-- Jalankan di Supabase SQL Editor SETELAH migrasi Fase E.
--
-- Skema spin_events sudah memenuhi seluruh rancangan di roadmap ML sejak Fase
-- D dan E. Yang tersisa satu kolom: is_raining.
--
-- Ditambahkan sekarang, bukan nanti saat model dikerjakan, karena alasan yang
-- sama dengan policy_score: konteks yang tidak dicatat saat penayangan tidak
-- bisa ditambahkan belakangan. Cuaca tiga minggu lalu di satu titik tidak bisa
-- direkonstruksi dengan benar, dan menebaknya sama saja menanam fitur palsu ke
-- dalam data latih.
-- ============================================================================

begin;

alter table public.spin_events
  add column if not exists is_raining boolean;

comment on column public.spin_events.is_raining is
  'Cuaca saat penayangan. NULL berarti TIDAK TAHU — bukan "tidak hujan". '
  'Terisi hanya kalau ENABLE_WEATHER_CONTEXT=true dan cache-nya hangat; '
  'jalur spin sengaja tidak pernah menunggu jaringan demi kolom ini.';

commit;
