import type { Metadata, Viewport } from "next";
import { Open_Sans, Poppins } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./lib/auth";
import { BRAND } from "./lib/core";

const poppins = Poppins({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-poppins", display: "swap" });
const openSans = Open_Sans({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-open-sans", display: "swap" });

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.description,
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${poppins.variable} ${openSans.variable}`}>
      <body className="antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
