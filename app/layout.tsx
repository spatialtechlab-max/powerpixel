import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/SiteHeader";
import { HomeBodyClass } from "@/components/HomeBodyClass";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Power Pixel Pro · The IP check before you post",
  description:
    "Drop an image. We scan for AI-generation signatures, popular brand logos, and hidden stock-preview watermarks before you ever publish. Five signals, one verdict.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <HomeBodyClass />
          <SiteHeader />
          <main className="min-h-screen">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
