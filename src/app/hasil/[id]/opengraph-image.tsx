import { ImageResponse } from "next/og";

import { getRestaurantById } from "@/lib/supabase/queries";

/**
 * Kartu gambar yang muncul saat tautan hasil ditempel di WA atau Line.
 *
 * Namanya dibaca dari database, bukan dari query string. Kartu yang teksnya
 * bisa diisi lewat URL akan jadi alat bagus untuk memalsukan pesan di atas
 * merek kita — dan sekali tersebar, tidak bisa ditarik.
 */

export const alt = "Hasil Gacha Makan";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: { id: string };
}) {
  let name = "Gacha Makan";
  let subtitle = "Bingung mau makan apa? Spin aja.";

  try {
    const restaurant = await getRestaurantById(params.id);
    if (restaurant) {
      // Nama panjang dipotong: teks yang meluber keluar kanvas terlihat rusak,
      // dan kartu yang terlihat rusak tidak akan dibagikan siapa pun.
      name = restaurant.name.length > 42
        ? `${restaurant.name.slice(0, 41)}…`
        : restaurant.name;

      const price = restaurant.price_tier
        ? `Rp${restaurant.price_tier.toLocaleString("id-ID")}`
        : null;

      subtitle = [restaurant.category, price].filter(Boolean).join(" · ") ||
        "Hasil gacha hari ini";
    }
  } catch {
    // Gambar tetap harus keluar. Kartu generik jauh lebih baik daripada
    // pratinjau yang gagal dimuat.
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#f43f5e",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 30, opacity: 0.85, letterSpacing: 4 }}>
          🎲 GACHA MAKAN HARI INI
        </div>

        <div
          style={{
            marginTop: 28,
            fontSize: 78,
            fontWeight: 800,
            lineHeight: 1.1,
            display: "flex",
          }}
        >
          {name}
        </div>

        <div style={{ marginTop: 28, fontSize: 36, opacity: 0.9, display: "flex" }}>
          {subtitle}
        </div>

        <div style={{ marginTop: 56, fontSize: 30, opacity: 0.8, display: "flex" }}>
          coba punyamu →
        </div>
      </div>
    ),
    size,
  );
}
