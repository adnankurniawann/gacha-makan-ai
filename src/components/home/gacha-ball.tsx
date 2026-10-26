/**
 * Bola gacha yang bergerak.
 *
 * Digambar dengan SVG, bukan foto stok. Foto restoran generik dari bank gambar
 * akan terasa seperti janji yang tidak ditepati begitu orang menggulir ke
 * katalog aslinya — dan foto stok justru salah satu penanda paling kuat bahwa
 * sebuah halaman dirakit asal-asalan.
 *
 * Gerakannya bertumpuk tiga lapis, masing-masing dengan durasi berbeda:
 *
 *   luar   (4,2 dtk)  naik-turun
 *   tengah (7 dtk)    getaran singkat, seolah baru diguncang mesin gacha
 *   dalam  (5,6 dtk)  oleng kiri-kanan
 *
 * Durasinya sengaja tidak kelipatan satu sama lain, jadi kombinasinya baru
 * berulang setelah lama sekali. Kalau semuanya satu irama, mata langsung
 * menangkap polanya dan gerakannya terasa mekanis.
 *
 * Dipisah jadi beberapa elemen karena satu elemen tidak bisa menjalankan dua
 * animasi transform sekaligus — yang belakangan akan menimpa yang sebelumnya.
 *
 * Animasinya CSS murni, bukan Framer Motion: elemen ini muncul di layar
 * pertama, dan menunggu mesin animasi diunduh dulu berarti membayar dua kali
 * di jaringan yang justru paling lambat.
 *
 * Semuanya berhenti saat `prefers-reduced-motion` — lihat globals.css.
 */
export function GachaBall({ className = "" }: { className?: string }) {
  return (
    <div className={`gacha-bob ${className}`} aria-hidden="true">
      <div className="gacha-rattle h-full w-full">
        <svg viewBox="0 0 200 200" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id="ball-top" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb7185" />
              <stop offset="100%" stopColor="#e11d48" />
            </linearGradient>
            <linearGradient id="ball-bottom" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e2e8f0" />
            </linearGradient>
          </defs>

          {/* Bayangan lantai. Di luar grup yang oleng, karena bayangan tidak
              ikut miring saat bendanya miring. */}
          <ellipse
            className="gacha-shadow"
            cx="100"
            cy="184"
            rx="46"
            ry="9"
            fill="#0f172a"
            opacity="0.13"
          />

          <g className="gacha-tilt">
            <circle cx="100" cy="100" r="72" fill="url(#ball-bottom)" />
            <path d="M28 100a72 72 0 0 1 144 0z" fill="url(#ball-top)" />
            <rect x="28" y="94" width="144" height="12" rx="6" fill="#9f1239" />
            <circle
              cx="100"
              cy="100"
              r="20"
              fill="#fff1f2"
              stroke="#9f1239"
              strokeWidth="7"
            />

            {/* Kilau, supaya bolanya terbaca sebagai benda dan bukan
                lingkaran datar. */}
            <ellipse
              className="gacha-shine"
              cx="72"
              cy="62"
              rx="17"
              ry="11"
              fill="#ffffff"
              transform="rotate(-28 72 62)"
            />
          </g>
        </svg>
      </div>
    </div>
  );
}
