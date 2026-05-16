"use client";

/**
 * Power Pixel Pro — wallet pill for the marketing surfaces.
 *
 * Wraps RainbowKit's ConnectButton.Custom in our own glass / white-pill
 * styling. Handles:
 *   - hydration loading (skeleton)
 *   - disconnected (white "connect wallet" CTA)
 *   - wrong network (amber pill, click to switch)
 *   - connected (truncated address + green dot, click to open account modal)
 *
 * Works on every browser RainbowKit supports: MetaMask, Coinbase Wallet,
 * Rainbow, Trust, plus any mobile wallet via WalletConnect QR.
 */

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown, AlertCircle } from "lucide-react";

export function WalletPill() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!ready) {
          return (
            <div className="h-10 w-36 rounded-full bg-white/[0.08] animate-pulse sm:h-11 sm:w-40" />
          );
        }

        if (!connected) {
          return (
            <button
              onClick={openConnectModal}
              className="rounded-full bg-white px-4 py-2.5 text-sm font-normal text-black transition-colors hover:bg-neutral-200 sm:px-6 sm:py-3"
            >
              connect wallet
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              onClick={openChainModal}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/60 bg-amber-400/15 px-4 py-2.5 text-sm font-normal text-amber-100 transition-colors hover:bg-amber-400/25 sm:px-5 sm:py-3"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              wrong network
            </button>
          );
        }

        return (
          <button
            onClick={openAccountModal}
            className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2.5 text-sm font-normal text-white ring-1 ring-inset ring-white/15 backdrop-blur-2xl transition-colors hover:bg-white/[0.12] sm:px-5 sm:py-3"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
            <span className="font-mono text-xs sm:text-sm">{account.displayName}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
