"use client";

/**
 * Power Pixel Pro — full-bleed hero.
 *
 * Readex Pro typography, encrypted-vibe Canvas background (hex-digit rain
 * instead of stock video), floating pill navbar with the voxel-P logo,
 * large staggered headline ("scan / your / post"), three stat callouts,
 * bottom gradient overlay. Pure black + white + white-opacity only.
 */

import Image from "next/image";
import Link from "next/link";
import FUIBentoGridDark from "@/components/ui/bento";
import {
  ContainerAnimated,
  ContainerStagger,
  GalleryGrid,
  GalleryGridCell,
} from "@/components/ui/cta-section-with-gallery";
import { Button } from "@/components/ui/button";

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "home", href: "/" },
  { label: "register", href: "/register" },
  { label: "lookup", href: "/lookup" },
  { label: "support", href: "#support" },
];

// Local UHD hero video. Served from /public for now; for production this
// should move to a CDN / Vercel Blob — 97 MB shouldn't ship in the repo.
const HERO_VIDEO = "/hero.mp4";

export default function HomePage() {
  return (
    <>
    <section className="relative h-screen w-full overflow-hidden bg-black">
      {/* Encrypted-vibe background video */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        src={HERO_VIDEO}
      />
      {/* Subtle vignette so the headlines stay legible over the video */}
      <div className="pointer-events-none absolute inset-0 bg-black/45" aria-hidden="true" />

      {/* Floating pill navbar */}
      <nav className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-4 px-6 pt-6 md:px-10">
        {/* Brand pill — voxel-P logo */}
        <div className="flex items-center gap-2 rounded-full bg-white/[0.06] py-2.5 pl-3 pr-6 backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/10">
          <Image
            src="/powerpixel-mark.png"
            alt="Power Pixel Pro"
            width={28}
            height={28}
            priority
            className="h-7 w-7 object-contain"
          />
          <span className="text-sm font-normal tracking-tight text-white">powerpixel</span>
        </div>

        {/* Center pill — links */}
        <div className="hidden items-center gap-1 rounded-full bg-white/[0.06] px-3 py-2 backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/10 md:flex">
          {NAV_LINKS.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              className="rounded-full px-5 py-2 text-sm text-neutral-300 transition-colors hover:text-white"
            >
              {label}
            </a>
          ))}
        </div>

        {/* Right CTA */}
        <Link
          href="/register"
          className="rounded-full bg-white px-6 py-3 text-sm font-normal text-black transition-colors hover:bg-neutral-200"
        >
          connect wallet
        </Link>
      </nav>

      {/* Foreground content */}
      <div className="relative h-full w-full">
        {/* Staggered headline */}
        <h1 className="hero-title absolute left-4 top-[18%] text-[14vw] font-medium text-white md:left-10 md:text-[13vw]">
          scan
        </h1>
        <h1 className="hero-title absolute right-4 top-[38%] text-[14vw] font-medium text-white md:right-10 md:text-[13vw]">
          your
        </h1>
        <h1 className="hero-title absolute left-[18%] top-[58%] text-[14vw] font-medium text-white md:left-[28%] md:text-[13vw]">
          post
        </h1>

        {/* Description */}
        <p className="absolute left-6 top-[46%] max-w-[240px] text-[15px] leading-snug text-white/90 md:left-10">
          we check every image for ai-generation signatures, brand logos, and
          hidden watermarks before it ever leaves your hands.
        </p>

        {/* Top-right stat */}
        <div className="absolute right-6 top-[14%] md:right-24">
          <div className="flex items-center justify-end gap-3">
            <span className="hidden h-px w-24 rotate-[20deg] bg-white/40 md:block" />
            <span className="text-4xl font-medium tracking-tight md:text-5xl">+65k</span>
          </div>
          <div className="mt-1 text-right text-xs text-white/70 md:text-sm">creators use</div>
        </div>

        {/* Bottom gradient overlay */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-b from-transparent to-black" />

        {/* Bottom-left stat */}
        <div className="absolute bottom-20 left-6 md:bottom-24 md:left-20">
          <div className="flex items-center gap-3">
            <span className="text-4xl font-medium tracking-tight md:text-5xl">+1.5b</span>
            <span className="hidden h-px w-24 -rotate-[20deg] bg-white/40 md:block" />
          </div>
          <div className="mt-1 text-xs text-white/70 md:text-sm">px scanned</div>
        </div>

        {/* Bottom-right stat */}
        <div className="absolute bottom-16 right-6 md:bottom-20 md:right-20">
          <div className="flex items-center justify-end gap-3">
            <span className="hidden h-px w-24 -rotate-[20deg] bg-white/40 md:block" />
            <span className="text-4xl font-medium tracking-tight md:text-5xl">+300k</span>
          </div>
          <div className="mt-1 text-right text-xs text-white/70 md:text-sm">images cleared</div>
        </div>
      </div>
    </section>

    {/* "How it works" — five-signal Bento grid */}
    <FUIBentoGridDark />

    {/* Closing CTA — staggered-text + asymmetric 4-image gallery
        (wrapped in the same container shell as the bento above so the
        left edges align across sections) */}
    <section className="bg-black">
      <div className="container mx-auto p-6 py-24 md:p-10 md:py-32">
        <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2">
        <ContainerStagger>
          <ContainerAnimated className="mb-3 text-sm uppercase tracking-[0.28em] text-white/70 md:text-base">
            ready when you are
          </ContainerAnimated>
          <ContainerAnimated className="hero-title text-3xl font-medium tracking-tight text-white md:text-5xl">
            Make every post defensible.
          </ContainerAnimated>
          <ContainerAnimated className="mt-2 bg-gradient-to-br from-white to-white/40 bg-clip-text text-2xl/8 font-medium tracking-tight text-transparent">
            Drop an image. We screen it for everything that gets people in
            trouble — AI provenance, popular brands, hidden stock marks. The
            work that&apos;s yours moves on. The work that isn&apos;t gets caught
            before it ships.
          </ContainerAnimated>
          <ContainerAnimated className="mt-8">
            <a href="/lookup">
              <Button className="bg-white text-black hover:bg-neutral-200">
                Scan an image
              </Button>
            </a>
          </ContainerAnimated>
        </ContainerStagger>

        <GalleryGrid>
          {[
            "https://images.unsplash.com/photo-1455849318743-b2233052fcff?q=80&w=2338&auto=format&fit=crop",
            "https://images.unsplash.com/photo-1733680958774-39a0e8a64a54?q=80&w=2487&auto=format&fit=crop",
            "https://images.unsplash.com/photo-1548783307-f63adc3f200b?q=80&w=2487&auto=format&fit=crop",
            "https://images.unsplash.com/photo-1703622377707-29bc9409aaf2?q=80&w=2400&auto=format&fit=crop",
          ].map((src, i) => (
            <GalleryGridCell index={i} key={i}>
              <img
                src={src}
                alt=""
                className="size-full object-cover object-center"
                width="100%"
                height="100%"
              />
            </GalleryGridCell>
          ))}
        </GalleryGrid>
        </div>
      </div>
    </section>
    </>
  );
}
