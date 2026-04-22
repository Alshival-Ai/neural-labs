import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Neural Labs",
  description: "A standalone browser-based desktop environment for Neural Labs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
