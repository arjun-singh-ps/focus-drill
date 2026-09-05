// Root layout: loads the two typefaces and applies the paper background.
//
// Source Serif 4 carries question text and passages; Inter carries every piece of
// UI chrome. They are bound to CSS variables here and consumed in globals.css.

import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Focus Drill",
  description: "Adaptive SAT practice.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Practice happens on a phone as often as a laptop; the theme colour keeps the
  // browser chrome from clashing with the paper background.
  themeColor: "#FDFBF7",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${sourceSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
