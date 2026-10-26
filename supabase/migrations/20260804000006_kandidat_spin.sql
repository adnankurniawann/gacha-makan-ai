-- ============================================================================
-- ML Fase 3 — mencatat himpunan kandidat
--
-- Jalankan di Supabase SQL Editor SETELAH migrasi ML Fase 0.
--
-- Evaluasi replay hanya sah kalau kita tahu ARM SET yang tersedia saat
-- keputusan diambil: "seandainya kebijakan baru memilih pada konteks yang
-- sama, apakah pilihannya sama dengan yang tercatat?" Pertanyaan itu tidak
-- bisa dijawab kalau yang tersimpan cuma satu restoran yang menang.
--
-- Sama seperti policy_score di Fase E: kolom ini murah dibuat sekarang dan
-- mustahil dibuat nanti. Tanpa ia, seluruh log yang terkumpul sebelum kolomnya
-- ada tidak bisa dipakai untuk Fase 4.
-- ============================================================================

begin;

alter table public.spin_events
  add column if not exists candidate_ids         uuid[],
  add column if not exists candidate_distances_m integer[];

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'spin_events_candidates_aligned'
  ) then
    -- Dua larik ini selalu berpasangan indeks per indeks. Kalau panjangnya
    -- berbeda, jarak kandidat ke-i menunjuk restoran yang salah, dan seluruh
    -- fitur jarak yang direkonstruksi nanti ikut salah tanpa ada yang error.
    alter table public.spin_events
      add constraint spin_events_candidates_aligned
      check (
        (candidate_ids is null and candidate_distances_m is null)
        or array_length(candidate_ids, 1) = array_length(candidate_distances_m, 1)
      );
  end if;
end $$;

comment on column public.spin_events.candidate_ids is
  'Seluruh restoran yang lolos filter saat penayangan ini, termasuk yang tidak '
  'terpilih. Wajib untuk evaluasi replay: tanpa arm set, tidak ada cara '
  'menanyakan apa yang AKAN dipilih kebijakan lain pada konteks yang sama.';

comment on column public.spin_events.candidate_distances_m is
  'Jarak tiap kandidat dalam meter, sejajar indeks dengan candidate_ids. '
  'Dibekukan karena jarak yang DIPERLIHATKAN saat itu tidak berubah walau '
  'koordinat warungnya dikoreksi belakangan.';

commit;
