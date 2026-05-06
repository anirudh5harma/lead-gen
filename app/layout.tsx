import type { Metadata } from "next";
import "./globals.css";
import { validateEnv } from "@/lib/env";
import { Analytics } from "@vercel/analytics/next"

if (typeof window === 'undefined') {
  validateEnv();
}

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
      className="h-full antialiased"
      style={{ colorScheme: "light" }}
    >
      <body className="min-h-full flex flex-col bg-[var(--color-ink-1)] text-[var(--color-text-1)]">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
