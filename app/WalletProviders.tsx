"use client";

/**
 * Wallet provider tree (Wagmi + RainbowKit + React-Query).
 *
 * Split into its own module so that importing `lib/wagmi` (which calls
 * RainbowKit's `getDefaultConfig` at module load and immediately spins up
 * a WalletConnect connector) only happens when this file is actually
 * loaded — i.e. only on routes that need a wallet. The router
 * (app/providers.tsx) gates this via a `next/dynamic` import so the
 * Power Pixel Pro routes ("/" and "/check") never pay the WC startup cost
 * or surface its noisy WS subscribe errors.
 */

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

export default function WalletProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#ECEEF2",
            accentColorForeground: "#0a0b0f",
            borderRadius: "medium",
            fontStack: "system",
            overlayBlur: "small",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
