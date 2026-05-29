import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { SharedHeader } from "@/components/shell/SharedHeader";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "@/components/ui/sonner";
import { CommandPalette } from "@/components/palette/command-palette";
import { PaletteHotkey } from "@/components/palette/palette-hotkey";
import { QueryProvider } from "@/components/providers/QueryProvider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AgenticOS",
  description: "AI agent orchestration dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" style={{ backgroundColor: "var(--bg)", color: "var(--text)" }}>
        <Suspense>
          <NuqsAdapter>
            <QueryProvider>
              <SharedHeader />
              <main className="flex-1 flex flex-col">
                {children}
              </main>
              <Toaster position="bottom-right" />
              <CommandPalette />
              <PaletteHotkey />
            </QueryProvider>
          </NuqsAdapter>
        </Suspense>
      </body>
    </html>
  );
}
