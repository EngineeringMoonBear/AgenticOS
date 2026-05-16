import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { Header } from "@/components/layout/header";
import { NuqsAdapter } from "nuqs/adapters/next/app";

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
            <Header />
            <main className="flex-1 flex flex-col">{children}</main>
          </NuqsAdapter>
        </Suspense>
      </body>
    </html>
  );
}
