"use client";

/**
 * Power Pixel Pro — three-step user procedure.
 *
 * Not internal signals — the *outward* flow the user experiences:
 *   1. Drop the file
 *   2. We check it
 *   3. It's signed on-chain
 *
 * Three equal-width bento cards. Each has a Google DeepMind Pexels
 * image as the dramatic graphic and a backdrop-blur copy block at the
 * bottom. No vendor names, no protocol names, no mechanism reveals.
 */

import { clsx } from "clsx";
import { motion } from "framer-motion";

export default function FUIBentoGridDark() {
  return (
    <div className="container mx-auto flex min-w-screen flex-col bg-gray-950/10 p-6 pt-32 md:p-10">
      <p className="mb-3 text-xs uppercase tracking-[0.28em] text-white/70">
        how it works
      </p>
      <h1 className="hero-title text-3xl font-medium tracking-tight md:text-5xl">
        Drop. Check. Sign.
      </h1>
      <p className="mt-2 max-w-3xl bg-gradient-to-br from-white to-white/40 bg-clip-text text-2xl/8 font-medium tracking-tight text-transparent">
        Three steps from upload to a tamper-proof, on-chain record. No accounts
        to set up, no plugins to install. Fifteen seconds end to end.
      </p>
      <div className="mt-10 grid grid-cols-1 gap-4 sm:mt-16 lg:grid-cols-3 lg:auto-rows-fr">
        <BentoCard
          eyebrow="Step 01"
          title="Drop the file"
          description="Drag any image into the browser. The original never leaves your device until you decide it should — every check that follows works on a derivative."
          graphic={
            <>
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: "url(/step-1.jpg)" }}
              />
              {/* Soft bottom-only gradient — keeps the top 60% of the image
                  fully visible, fades into the copy block's blur area */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            </>
          }
          className="max-lg:rounded-t-4xl lg:rounded-l-4xl"
        />
        <BentoCard
          eyebrow="Step 02"
          title="We check it"
          description="A multi-stage scan inspects every layer of the image — provenance, structure, brand presence, hidden marks. One verdict in under fifteen seconds."
          graphic={
            <>
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: "url(/step-2.jpg)" }}
              />
              {/* Soft bottom-only gradient — keeps the top 60% of the image
                  fully visible, fades into the copy block's blur area */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            </>
          }
        />
        <BentoCard
          eyebrow="Step 03"
          title="Signed on-chain"
          description="If it clears, the work is timestamped on Ethereum and you walk away with a downloadable, court-admissible evidence bundle. Anyone can verify it. No one can rewrite it."
          graphic={
            <>
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: "url(/step-3.jpg)" }}
              />
              {/* Soft bottom-only gradient — keeps the top 60% of the image
                  fully visible, fades into the copy block's blur area */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            </>
          }
          className="max-lg:rounded-b-4xl lg:rounded-r-4xl"
        />
      </div>
    </div>
  );
}

export function BentoCard({
  dark = false,
  className = "",
  eyebrow,
  title,
  description,
  graphic,
  fade = [],
}: {
  dark?: boolean;
  className?: string;
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  graphic?: React.ReactNode;
  fade?: ("top" | "bottom")[];
}) {
  return (
    <motion.div
      initial="idle"
      whileHover="active"
      variants={{ idle: {}, active: {} }}
      data-dark={dark ? "true" : undefined}
      className={clsx(
        className,
        "group relative flex flex-col overflow-hidden rounded-lg",
        "bg-black shadow-sm ring-1 ring-white/10 transform-gpu dark:bg-transparent dark:[border:1px_solid_rgba(255,255,255,.1)] dark:[box-shadow:0_-20px_80px_-20px_#8686f01f_inset]",
        "data-[dark]:bg-gray-800 data-[dark]:ring-white/15"
      )}
    >
      <div className="relative h-[29rem] shrink-0">
        {graphic}
        {fade.includes("top") && (
          <div className="absolute inset-0 bg-gradient-to-b from-white to-50% opacity-25 group-data-[dark]:from-gray-800 group-data-[dark]:from-[-25%]" />
        )}
        {fade.includes("bottom") && (
          <div className="absolute inset-0 bg-gradient-to-t from-white to-50% opacity-25 group-data-[dark]:from-gray-800 group-data-[dark]:from-[-25%]" />
        )}
      </div>
      <div className="relative z-20 isolate mt-[-110px] h-[14rem] p-10 text-white backdrop-blur-xl">
        <p className="text-xs uppercase tracking-[0.25em] text-white/70">
          {eyebrow}
        </p>
        <p className="text-gray-150 mt-1 text-2xl/8 font-medium tracking-tight dark:text-gray-100 group-data-[dark]:text-white">
          {title}
        </p>
        <p className="mt-2 max-w-[600px] text-sm/6 text-gray-100 dark:text-gray-300 group-data-[dark]:text-gray-400">
          {description}
        </p>
      </div>
    </motion.div>
  );
}
