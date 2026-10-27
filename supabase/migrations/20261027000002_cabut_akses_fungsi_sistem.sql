-- ==========================================================================
-- Cabut akses pengguna ke mark_ignored_spins
--
-- Migrasi spin_events hanya menjalankan `revoke ... from public`. Di Supabase,
-- hak EXECUTE fungsi baru juga diberikan langsung ke anon dan authenticated
-- lewat default privileges, jadi revoke dari public tidak menutupnya. Akibatnya
-- siapa pun dengan anon key bisa memanggil
--   rpc('mark_ignored_spins', { p_older_than: '0 seconds' })
-- dan menandai semua spin yang masih menunggu respons sebagai 'ignored' —
-- "Jadi ke sini" sesudahnya ditolak karena respons pertama yang menang.
--
-- Fungsi ini pekerjaan sistem (pg_cron berjalan sebagai postgres), bukan
-- pengguna. Diperiksa oleh scripts/verify-rls.mjs. Idempoten.
-- ==========================================================================

begin;

revoke execute on function public.mark_ignored_spins(interval) from anon, authenticated;

commit;
