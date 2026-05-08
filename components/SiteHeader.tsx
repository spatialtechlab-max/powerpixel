"use client";

import * as React from "react";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, AlertCircle, ChevronDown } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Register", href: "/register" },
  { label: "Look up", href: "/lookup" },
];

export function SiteHeader() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const toggleMenu = () => setIsOpen((v) => !v);

  // SiteHeader uses RainbowKit's ConnectButton which calls wagmi's
  // useConfig() — that requires WagmiProvider in scope. WagmiProvider
  // ONLY mounts on /register (see app/providers.tsx WALLET_ROUTES). So
  // SiteHeader can only render on /register. Anywhere else (/, /lookup,
  // /_not-found, etc.) we'd crash with `useConfig must be used within
  // WagmiProvider` — including during static generation in the Vercel
  // build.
  if (pathname !== "/register") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex w-full justify-center px-4 py-4 sm:py-6">
      <div className="pointer-events-auto relative z-10 flex w-full max-w-4xl items-center justify-between gap-4 rounded-full border border-white/10 bg-bg/55 px-3 py-2 shadow-[0_8px_40px_-8px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:px-4">
        {/* Brand */}
        <Link href="/" className="group flex items-center gap-2.5 pl-2 shrink-0">
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileHover={{ rotate: 8 }}
            transition={{ duration: 0.3 }}
            className="h-7 w-7"
          >
            <Image
              src="/logo.png"
              alt="DoNotTrain"
              width={28}
              height={28}
              priority
              className="h-7 w-7 object-contain invert opacity-95 group-hover:opacity-100 transition"
            />
          </motion.div>
          <span className="text-[14px] font-medium tracking-tight text-text-primary">
            DoNotTrain
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item, i) => {
            const active = pathname === item.href;
            return (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.04 * i }}
              >
                <Link
                  href={item.href}
                  className={`relative inline-flex h-8 items-center px-3 text-[13px] rounded-full transition ${
                    active
                      ? "text-text-primary bg-surface"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface/60"
                  }`}
                >
                  {item.label}
                </Link>
              </motion.div>
            );
          })}

          {/* Network chip — visually reinforces "live on Sepolia" */}
          <div className="ml-2 inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full border border-border bg-surface/60 text-[10px] mono uppercase tracking-[0.15em] text-text-secondary">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            Sepolia
          </div>
        </nav>

        {/* Right side: connect wallet (desktop) */}
        <div className="hidden md:block">
          <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
              const ready = mounted;
              const connected = ready && account && chain;

              if (!ready) {
                return <div className="h-9 w-32 rounded-full bg-surface animate-pulse" />;
              }

              if (!connected) {
                return (
                  <motion.button
                    onClick={openConnectModal}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className="inline-flex h-9 items-center px-4 rounded-full bg-text-primary text-bg text-[13px] font-medium hover:bg-white transition"
                  >
                    Connect wallet
                  </motion.button>
                );
              }

              if (chain.unsupported) {
                return (
                  <button
                    onClick={openChainModal}
                    className="inline-flex h-9 items-center gap-1.5 px-3 rounded-full border border-warning/40 bg-warning/10 text-warning text-[13px] font-medium hover:bg-warning/15 transition"
                  >
                    <AlertCircle className="h-3.5 w-3.5" />
                    Wrong network
                  </button>
                );
              }

              return (
                <button
                  onClick={openAccountModal}
                  className="inline-flex h-9 items-center gap-2 px-3 rounded-full border border-border bg-surface/70 hover:border-text-tertiary text-[13px] text-text-primary transition"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" aria-hidden="true" />
                  <span className="mono text-[12px]">{account.displayName}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              );
            }}
          </ConnectButton.Custom>
        </div>

        {/* Mobile hamburger */}
        <motion.button
          className="flex items-center md:hidden text-text-primary p-1"
          onClick={toggleMenu}
          whileTap={{ scale: 0.9 }}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </motion.button>
      </div>

      {/* Mobile overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0 z-50 bg-bg pt-24 px-6 md:hidden"
            initial={{ opacity: 0, x: "100%" }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <motion.button
              className="absolute top-6 right-6 p-2 text-text-primary"
              onClick={toggleMenu}
              whileTap={{ scale: 0.9 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              aria-label="Close menu"
            >
              <X className="h-6 w-6" />
            </motion.button>

            <div className="flex flex-col gap-5">
              {NAV.map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: i * 0.08 + 0.1 }}
                >
                  <Link
                    href={item.href}
                    onClick={toggleMenu}
                    className={`block text-[18px] font-medium ${
                      pathname === item.href ? "text-text-primary" : "text-text-secondary"
                    }`}
                  >
                    {item.label}
                  </Link>
                </motion.div>
              ))}

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ delay: 0.4 }}
                className="pt-4"
                onClick={toggleMenu}
              >
                <ConnectButton.Custom>
                  {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
                    if (!mounted) return null;
                    const connected = account && chain;
                    return (
                      <button
                        onClick={connected ? openAccountModal : openConnectModal}
                        className="inline-flex w-full justify-center items-center gap-2 px-5 py-3 rounded-full bg-text-primary text-bg text-[14px] font-medium hover:bg-white transition"
                      >
                        {connected ? account.displayName : "Connect wallet"}
                      </button>
                    );
                  }}
                </ConnectButton.Custom>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
