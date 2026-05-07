import type { Metadata } from "next";
import "./globals.css";
import { validateEnv } from "@/lib/env";
import { Analytics } from "@vercel/analytics/next"
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

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

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});

export const metadata: Metadata = {
  title: "Bombsell — Sell at the moment it matters",
  description:
    "Real-time company signals + extremely personalized outreach. Convert at 4x higher rates by reaching out the moment companies are ready.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
      style={{ colorScheme: "light" }}
    >
      <body className="min-h-full flex flex-col bg-[var(--color-ink-1)] text-[var(--color-text-1)] font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
