import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["500", "600"],
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
    <html lang="fr" className={fraunces.variable}>
      <body className="bg-cream-50 text-ink-900 antialiased">{children}</body>
    </html>
  );
}
