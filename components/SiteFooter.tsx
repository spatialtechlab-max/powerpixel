"use client";

import { usePathname } from "next/navigation";
import { addressUrl, CONTRACT_ADDRESS } from "@/lib/contract";

export function SiteFooter() {
  const pathname = usePathname();
  // The Power Pixel Pro routes are full-bleed dark canvas and self-contained.
  if (pathname === "/" || pathname === "/lookup") return null;

  return (
    <footer className="border-t border-border/60 mt-12 py-10">
      <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[12px] text-text-tertiary">
        <div>Power Pixel Pro · IP scan before publish</div>
        <div className="flex items-center gap-5">
          <a
            href={addressUrl(CONTRACT_ADDRESS)}
            target="_blank"
            rel="noreferrer"
            className="hover:text-text-primary transition"
          >
            Etherscan
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="hover:text-text-primary transition"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
