import type { Metadata } from "next";

import { ThemeProvider } from "@/components/providers/theme-provider";

import "./globals.css";
import "@xterm/xterm/css/xterm.css";
import "monaco-editor/min/vs/editor/editor.main.css";

export const metadata: Metadata = {
  title: "Neural Labs",
  description: "A standalone browser-based desktop environment for Neural Labs.",
  icons: {
    icon: "/brand/alshival-brain-256.png",
    apple: "/brand/alshival-brain-256.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
