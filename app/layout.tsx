import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  preload: false,
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-bricolage",
});

export const metadata: Metadata = {
  title: "Bombsell | Signal-led outbound",
  description:
    "Profile, quality signals, verified contacts, and email or LinkedIn outreach for founders and lean teams.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${geistSans.variable} ${geistMono.variable} ${bricolage.variable}`}
      style={{ colorScheme: "light" }}
    >
      <body className="min-h-full flex flex-col bg-[var(--color-ink-1)] text-[var(--color-text-1)] font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
