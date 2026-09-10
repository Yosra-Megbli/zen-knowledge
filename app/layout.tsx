import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ZEN Knowledge",
  description: "Plateforme RAG interne multi-entreprises — Phase 1: foundation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
