"use client";

/**
 * Jaring pengaman terakhir: dipakai kalau root layout sendiri yang gagal,
 * yaitu kasus di mana app/error.tsx tidak sempat dirender. Karena menggantikan
 * seluruh dokumen, komponen ini harus membawa <html> dan <body> sendiri dan
 * tidak boleh bergantung pada apa pun dari layout.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[app/global-error]", error);

  return (
    <html lang="id">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f8fafc",
          color: "#1e293b",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "22rem" }}>
          <div style={{ fontSize: "48px", marginBottom: "20px" }}>🍜</div>
          <h1 style={{ fontSize: "20px", fontWeight: 800, margin: 0 }}>
            Gacha Makan lagi bermasalah
          </h1>
          <p
            style={{
              marginTop: "8px",
              fontSize: "14px",
              lineHeight: 1.6,
              color: "#64748b",
            }}
          >
            Aplikasinya gagal dimuat sepenuhnya. Coba muat ulang halaman ini.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "28px",
              width: "100%",
              border: "none",
              borderRadius: "12px",
              background: "#f43f5e",
              color: "white",
              padding: "12px 20px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Muat ulang
          </button>
        </div>
      </body>
    </html>
  );
}
