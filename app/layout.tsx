import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ZEN Knowledge",
  description: "Plateforme RAG interne multi-entreprises",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={spaceGrotesk.variable}>
      <body className="bg-paper-100 text-ink-900 antialiased">{children}</body>
    </html>
  );
}
