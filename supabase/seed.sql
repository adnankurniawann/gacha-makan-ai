-- ==========================================================
-- GACHA MAKAN - MASTER DATA SEED
-- Deskripsi: Data restoran Jatinangor (Google Maps) untuk Spin & Map.
-- Cara Pakai: Copy-paste isi file ini ke SQL Editor Supabase.
-- ==========================================================

-- 0. FIX: Ensure hygiene_reports.user_id is nullable (for anon reports)
alter table hygiene_reports alter column user_id drop not null;

-- 1. Bersihkan data lama (agar tidak duplikat saat re-seed)
DELETE FROM hygiene_reports;
DELETE FROM user_history;
DELETE FROM restaurants;

-- 2. Masukkan Data Restoran Jatinangor
-- PENTING: Format POINT = (Longitude, Latitude).

INSERT INTO restaurants (name, category, price_tier, location, hygiene_score, is_verified_safe)
VALUES
  ('Jatinangor House', 'Restaurant', 25000, ST_GeographyFromText('POINT(107.774269 -6.9362332)'), 80, false),
  ('Rumah Makan Khas Sunda Cibiuk', 'Sundanese restaurant', 25000, ST_GeographyFromText('POINT(107.7700136 -6.9347196)'), 92, false),
  ('Warung Jembatan (Warjem)', 'Restaurant', 15000, ST_GeographyFromText('POINT(107.7680842 -6.9347331)'), 92, true),
  ('Ketan Susu Bang Zul Jatinangor', 'Restaurant', 15000, ST_GeographyFromText('POINT(107.773649 -6.9357382)'), 96, true),
  ('Kantin Jatinangor', 'Buffet restaurant', 15000, ST_GeographyFromText('POINT(107.7744413 -6.9331791)'), 94, true),
  ('Cafe Tiwal (Titik Awal Kopitiam Jatinangor)', 'Restaurant', 15000, ST_GeographyFromText('POINT(107.7708691 -6.9374371)'), 96, true),
  ('Rumah Makan Organik Saung Nini', 'Sundanese restaurant', 25000, ST_GeographyFromText('POINT(107.7893372 -6.9216124)'), 80, false),
  ('Dimsum Bos Jatinangor', 'Dumpling restaurant', 15000, ST_GeographyFromText('POINT(107.7739889 -6.933277)'), 96, false),
  ('Ayam Crisbar Jatinangor', 'Chicken restaurant', 15000, ST_GeographyFromText('POINT(107.7692999 -6.9344334)'), 98, true),
  ('Warkop Agam Medan - Jatinangor', 'Restaurant', 15000, ST_GeographyFromText('POINT(107.7756627 -6.9328874)'), 96, true),
  ('Warung Tek Las, Jatinangor', 'Restaurant', 15000, ST_GeographyFromText('POINT(107.7735813 -6.9394659)'), 86, true),
  ('D''cota cafe jatinangor', 'Restaurant', 15000, ST_GeographyFromText('POINT(107.7616308 -6.9353789)'), 98, false),
  ('Wingz O Wingz - Jatinangor', 'Restaurant', 15000, ST_GeographyFromText('POINT(107.7736212 -6.9388612)'), 82, true),
  ('Hotway''s Chicken Jatinangor', 'Chicken restaurant', 15000, ST_GeographyFromText('POINT(107.7717502 -6.934921)'), 96, true),
  ('RM. Rasana Jatinangor', 'Restaurant', 15000, ST_GeographyFromText('POINT(107.7664385 -6.9351735)'), 88, true),
  ('Warkop ADD Jatinangor', 'Restaurant', 15000, ST_GeographyFromText('POINT(107.7732436 -6.9345868)'), 94, true),
  ('Lazatto Chiken & burger Jatinangor', 'Restaurant', 15000, ST_GeographyFromText('POINT(107.7780917 -6.9318935)'), 96, true),
  ('Wareg - Jatinangor', 'Diner', 15000, ST_GeographyFromText('POINT(107.7724534 -6.9470851)'), 96, true),
  ('Rempah Bumi 2 Jatinangor', 'Western restaurant', 15000, ST_GeographyFromText('POINT(107.7723355 -6.9334497)'), 88, true),
  ('Putra Aceh', 'Noodle shop', 15000, ST_GeographyFromText('POINT(107.770101 -6.934211)'), 92, true),
  ('Ramen Kakek Jepang Jatinangor', 'Ramen restaurant', 15000, ST_GeographyFromText('POINT(107.7758053 -6.9325804)'), 94, true),
  ('Waroeng Spesial Sambal "SS" Jatinangor', 'Javanese restaurant', 15000, ST_GeographyFromText('POINT(107.7723718 -6.9458621)'), 88, true),
  ('Pizza Hut Restoran - Jatinangor Town Square', 'Pizza restaurant', 25000, ST_GeographyFromText('POINT(107.7714096 -6.9343242)'), 96, true),
  ('Kaybun Dimsum Jatinangor', 'Dumpling restaurant', 15000, ST_GeographyFromText('POINT(107.7722003 -6.9334418)'), 90, true),
  ('Brother coffee', 'Coffee shop', 15000, ST_GeographyFromText('POINT(107.773897 -6.933099)'), 88, true),
  ('Warung Lamongan Food Court', 'Javanese restaurant', 15000, ST_GeographyFromText('POINT(107.7695288 -6.934405)'), 92, true),
  ('Mie Gerlong Jatinangor', 'Chinese restaurant', 15000, ST_GeographyFromText('POINT(107.7754665 -6.9327013)'), 96, true),
  ('Oppa Fried Chicken Jatinangor', 'Fast food restaurant', 15000, ST_GeographyFromText('POINT(107.7710928 -6.9338967)'), 96, true),
  ('Wasabi Kitchen Jatinangor (Wasabi Sushi & Ramen)', 'Restaurant', 25000, ST_GeographyFromText('POINT(107.7688362 -6.9383156)'), 86, true),
  ('Nasi kulit jatinangor', 'Restaurant', 15000, ST_GeographyFromText('POINT(107.776026 -6.932487)'), 96, true);

-- 3. Contoh laporan higienitas (opsional, isi manual lewat aplikasi)
