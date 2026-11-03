import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionBootstrap } from "@/components/auth/session-bootstrap";
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";

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
      {/* font-sans: tumpukan font sistem bawaan Tailwind — tidak ada berkas
          font yang diunduh, jadi teks langsung tampil di 4G yang goyah. */}
      <body className="min-h-screen font-sans antialiased">
        {children}
        <SessionBootstrap />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
