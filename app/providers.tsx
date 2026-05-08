"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

/**
 * Wallet routes get the full Wagmi/RainbowKit tree. Everything else
 * (Power Pixel Pro hero + scan flow) renders children directly with no
 * wallet imports executed — that's how we avoid the WalletConnect WS
 * subscribe runtime error on the new product surface.
 *
 * `next/dynamic` defers the import of WalletProviders (and therefore
 * `lib/wagmi`, which initializes WalletConnect at module load) until the
 * router lands on a wallet route. Module side effects don't fire until
 * then.
 */
const WalletProviders = dynamic(() => import("./WalletProviders"), {
  ssr: false,
});

// /lookup is now the Power Pixel Pro scan page (no wallet). Only the
// legacy /register page still mounts the wallet provider tree.
const WALLET_ROUTES = new Set(["/register"]);

/**
 * Backstop suppressor for any WalletConnect noise that does manage to
 * leak through. Caught both as a Promise rejection and as a synchronous
 * Error event, with capture-phase listening so it runs before Next.js's
 * dev overlay.
 */
function useSuppressWalletConnectNoise() {
  useEffect(() => {
    const noise = [
      /Connection interrupted while trying to subscribe/i,
      /Connection failed or socket disconnected/i,
      /pingTimeoutMs/i,
      /WebSocket connection closed abnormally/i,
      /relayer\.publish/i,
    ];
    const matches = (msg: string) => noise.some((re) => re.test(msg));

    const onRejection = (event: PromiseRejectionEvent) => {
      const msg = String(event.reason?.message ?? event.reason ?? "");
      if (matches(msg)) event.preventDefault();
    };
    const onError = (event: ErrorEvent) => {
      const msg = String(event.error?.message ?? event.message ?? "");
      if (matches(msg)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError, true);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError, true);
    };
  }, []);
}

export function Providers({ children }: { children: ReactNode }) {
  useSuppressWalletConnectNoise();
  const pathname = usePathname();

  if (!WALLET_ROUTES.has(pathname)) {
    // Power Pixel Pro routes: do not load wallet code at all.
    return <>{children}</>;
  }

  return <WalletProviders>{children}</WalletProviders>;
}
