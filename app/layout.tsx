import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZEN Knowledge",
  description: "Plateforme RAG interne multi-entreprises",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
