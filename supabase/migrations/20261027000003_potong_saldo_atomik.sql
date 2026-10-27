-- ==========================================================================
-- Potong saldo dalam satu UPDATE
--
-- /api/wallet/deduct dulu membaca saldo, menguranginya di JavaScript, lalu
-- menulis hasilnya. Dua permintaan yang berbarengan membaca saldo yang sama,
-- dan salah satu potongan hilang: saldo 50.000, potong 15.000 dan 20.000 dari
-- dua tab, hasilnya 30.000 alih-alih 15.000.
--
-- `current_balance = current_balance - p_amount` dikunci per baris oleh
-- Postgres, jadi potongan yang berbarengan antre, tidak saling menimpa.
--
-- security invoker: berjalan dengan hak pemanggil, jadi policy
-- wallets_update_own tetap berlaku. Fungsi ini tidak memberi hak baru.
-- Mengembalikan null kalau pengguna belum punya dompet. Idempoten.
-- ==========================================================================

begin;

create or replace function public.deduct_wallet(p_amount integer)
returns integer
language sql
security invoker
set search_path = public, pg_temp
as $$
  update public.wallets
     set current_balance = current_balance - p_amount,
         last_updated    = now()
   where user_id = auth.uid()
     and p_amount > 0
  returning current_balance;
$$;

revoke execute on function public.deduct_wallet(integer) from public, anon;
grant execute on function public.deduct_wallet(integer) to authenticated;

commit;
