import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vórtex Scan - Tus documentos, sin límites",
  description:
    "Vórtex Scan, de Vortex Company: escáner de documentos con cámara, aplanado de perspectiva, filtros B/N, exportación a PDF y lector de QR y códigos de barras. Gratis, sin anuncios y 100% local en tu navegador.",
  keywords: [
    "Vórtex Scan",
    "escáner de documentos",
    "escáner online",
    "lector QR",
    "código de barras",
    "imagen a PDF",
    "aplanar documento",
    "sin anuncios",
  ],
  authors: [{ name: "Vortex Company" }],
  icons: {
    icon:
      "data:image/svg+xml," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="#161616"/><circle cx="24" cy="24" r="17" fill="none" stroke="#10b981" stroke-width="3.5"/><path d="M24 10a14 14 0 1 1-9.9 4.1" fill="none" stroke="#34d399" stroke-width="3.5" stroke-linecap="round"/><path d="M24 17a7 7 0 1 0 7 7" fill="none" stroke="#34d399" stroke-width="3.5" stroke-linecap="round"/><circle cx="24" cy="24" r="3" fill="#34d399"/></svg>`
      ),
  },
  openGraph: {
    title: "Vórtex Scan - Tus documentos, sin límites",
    description:
      "Escáner de documentos con cámara, filtros B/N, PDF y lector de QR y códigos. Gratis, sin anuncios y 100% local. De Vortex Company, la misma compañía de Vórtex Music.",
    siteName: "Vórtex Scan",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f0f10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-[#0f0f10] text-[#ececf1]">{children}</body>
    </html>
  );
}
