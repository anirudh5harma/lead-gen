import type { Metadata } from "next";
import "./globals.css";
import { validateEnv } from "@/lib/env";
import { Analytics } from "@vercel/analytics/next"
import { Geist, Geist_Mono, Instrument_Serif, Manrope } from "next/font/google";

if (typeof window === 'undefined') {
  validateEnv();
}

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});

export const metadata: Metadata = {
  title: "Bombsell - AI GTM Infrastructure",
  description:
    "AI-native GTM Infrastructure for Agents, Teams and SMBs. Building the future GTM Stack. Pay for outcomes."
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${geistSans.variable} ${geistMono.variable} ${manrope.variable} ${instrumentSerif.variable}`}
      style={{ colorScheme: "light" }}
    >
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--color-ink-1)] text-[var(--color-text-1)] font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
