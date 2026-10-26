import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { SessionBootstrap } from "@/components/auth/session-bootstrap";
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";

/**
 * Plus Jakarta Sans menggantikan Poppins.
 *
 * Poppins berbasis lingkaran geometris: tiap huruf hampir sama lebarnya, dan
 * pada bobot tebal — yang dipakai di hampir seluruh aplikasi ini — teksnya
 * jadi rapat dan berat. Itu sebagian besar penyebab tampilannya terasa kaku.
 *
 * Plus Jakarta Sans punya bentuk huruf yang lebih bervariasi, jadi kalimat
 * masih terbaca enak pada bobot 400. Bobot 800 sengaja TIDAK diambil: ia
 * tidak diunduh, jadi tidak ada yang bisa memakainya tanpa sadar.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "Gacha Makan - Jatinangor",
  description: "Solusi decision fatigue buat mahasiswa laper",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "GachaMakan",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#f43f5e",
  // Konteks pemakaian nyata adalah HP di pinggir jalan, bukan laptop.
  width: "device-width",
  initialScale: 1,
  // Zoom sengaja TIDAK dikunci: mengunci zoom menutup satu-satunya jalan
  // sebagian orang untuk membaca teks kecil.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        {/* Link Font Awesome supaya icon <i className="fa-solid ..."> muncul */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        />
      </head>
      <body className={`${jakarta.variable} min-h-screen antialiased`}>
        {children}
        <SessionBootstrap />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
