import type { Metadata, Viewport } from "next";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "INuvem — Painel da loja",
  description: "Painel privado para administrar os produtos da loja na Nuvemshop.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "INuvem", statusBarStyle: "default" },
  icons: { icon: "/api/pwa/icone/192", apple: "/api/pwa/icone/180" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#4338ca" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
