-- Aktifkan ekstensi PostGIS untuk query jarak
create extension if not exists postgis;
create extension if not exists "uuid-ossp";

-- 1. Tabel Users
create table if not exists users (
  id uuid references auth.users not null primary key,
  full_name text,
  email text,
  monthly_budget int default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Tabel Restaurants (Warung Makan)
create table if not exists restaurants (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  category text, -- e.g., 'Ayam', 'Mie', 'Warteg'
  price_tier int, -- Estimasi harga maksimal (misal: 15000, 25000)
  location geography(point) not null, -- Kordinat lokasi untuk perhitungan jarak
  hygiene_score int default 100, -- Base score 100
  is_verified_safe boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2a. Fungsi helper untuk candidate spin berbasis PostGIS
create or replace function get_eligible_restaurants(
  budget integer,
  radius_meters integer,
  user_lat double precision,
  user_lng double precision
)
returns table (
  id uuid,
  name text,
  category text,
  price_tier int,
  hygiene_score int,
  distance int
)
language sql
stable
as $$
  select
    r.id,
    r.name,
    r.category,
    r.price_tier,
    r.hygiene_score,
    round(
      ST_Distance(
        r.location,
        st_setsrid(st_makepoint(user_lng, user_lat), 4326)::geography
      )
    )::int as distance
  from restaurants r
  where r.hygiene_score >= 50
    and r.price_tier <= budget
    and ST_Distance(
      r.location,
      st_setsrid(st_makepoint(user_lng, user_lat), 4326)::geography
    ) <= radius_meters
  order by distance asc, price_tier asc, hygiene_score desc, name asc;
$$;

-- 3. Tabel Hygiene Reports (Flag Kebersihan)
create table if not exists hygiene_reports (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references users(id),
  restaurant_id uuid references restaurants(id) not null,
  report_type text not null, -- 'RED_FLAG' atau 'CLEAN'
  description text, -- "Banyak lalat di etalase"
  reporter_ip text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table hygiene_reports
  add column if not exists reporter_ip text;

create index if not exists hygiene_reports_restaurant_ip_created_at_idx
  on hygiene_reports (restaurant_id, reporter_ip, created_at desc);

-- 4. Tabel User History (Riwayat Gacha/Makan)
create table if not exists user_history (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references users(id) not null,
  restaurant_id uuid references restaurants(id) not null,
  budget_used int,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Row Level Security
--    Kebijakan RLS yang berlaku TIDAK lagi didefinisikan di sini. Semuanya
--    pindah ke supabase/migrations/20260804000001_rls_hardening.sql, yang
--    harus dijalankan setelah file ini.
--
--    File ini dulu memasang policy `restaurants_update_public` dengan
--    using(true) — artinya siapa pun yang punya anon key (yaitu siapa pun yang
--    membuka aplikasinya) bisa mengubah katalog restoran. Jangan dihidupkan
--    lagi. Perubahan hygiene_score sekarang lewat submit_hygiene_report().
--
--    Setelah menjalankan schema.sql, WAJIB lanjut ke file migrasi tersebut,
--    lalu buktikan dengan `node scripts/verify-rls.mjs`.

create table public.wallets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null unique,
  monthly_budget integer default 0,       -- Total budget yang diset untuk bulan ini
  current_balance integer default 0,      -- Sisa saldo saat ini
  last_updated timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Buka akses RLS (Row Level Security) supaya user cuma bisa akses dompetnya sendiri
alter table public.wallets enable row level security;

create policy "User can view own wallet" 
  on public.wallets for select using (auth.uid() = user_id);

create policy "User can update own wallet" 
  on public.wallets for update using (auth.uid() = user_id);

create policy "User can insert own wallet" 
  on public.wallets for insert with check (auth.uid() = user_id);