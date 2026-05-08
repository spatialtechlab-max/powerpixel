"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Toggles the `is-home` class on <html> and <body> when the user is on
 * the marketing hero ("/") so the global dark-theme tokens give way to
 * the pure-black hero canvas. Other routes keep the existing styling.
 */
export function HomeBodyClass() {
  const pathname = usePathname();
  useEffect(() => {
    const onHome = pathname === "/" || pathname === "/lookup";
    document.documentElement.classList.toggle("is-home", onHome);
    document.body.classList.toggle("is-home", onHome);
  }, [pathname]);
  return null;
}
