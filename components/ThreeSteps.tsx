"use client";

/**
 * Power Pixel Pro — "how it works" section.
 *
 * Three steps below the hero. Premium, restrained — large numbered
 * blocks with generous whitespace, sans-serif Readex Pro display
 * sizes, single-property fade-up entrance via GSAP ScrollTrigger.
 * No parallax, no horizontal scroll-jacking, no bouncy easing —
 * Linear / Stripe Atlas / Apple-pages sensibility.
 */

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
  {
    num: "01",
    kicker: "drop",
    title: "drop the file",
    body: "any image, any source. nothing uploads anywhere visible — the moment you drop it, five independent checks fire in parallel.",
  },
  {
    num: "02",
    kicker: "scan",
    title: "five signals run",
    body: "content credentials, pixel-level ai classifier, two vision-language models with web search, ocr-driven brand recognition, corner-crop watermark scan.",
  },
  {
    num: "03",
    kicker: "verdict",
    title: "one clean answer",
    body: "block or allow, in about fifteen seconds. ai watermarks, popular brands, and stock-preview overlays are caught before anything ships. clean originals pass through.",
  },
];

export function ThreeSteps() {
  const container = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      // Header fade-up
      gsap.from(".pp-header > *", {
        opacity: 0,
        y: 24,
        duration: 1,
        ease: "power3.out",
        stagger: 0.08,
        scrollTrigger: {
          trigger: ".pp-header",
          start: "top 78%",
          toggleActions: "play none none reverse",
        },
      });

      // Each step block — same easing, slight stagger for a calm cadence
      gsap.utils.toArray<HTMLElement>(".pp-step").forEach((step, i) => {
        gsap.from(step, {
          opacity: 0,
          y: 32,
          duration: 1.1,
          ease: "power3.out",
          delay: i * 0.06,
          scrollTrigger: {
            trigger: step,
            start: "top 82%",
            toggleActions: "play none none reverse",
          },
        });
      });
    },
    { scope: container }
  );

  return (
    <section
      ref={container}
      className="relative bg-black px-6 py-32 text-white md:px-10 md:py-44"
    >
      <div className="mx-auto max-w-6xl">
        {/* Section header */}
        <div className="pp-header mb-20 md:mb-28">
          <p className="mb-5 text-xs uppercase tracking-[0.28em] text-white/70">
            how it works
          </p>
          <h2 className="hero-title text-[clamp(40px,6vw,72px)] font-medium leading-[1.02] tracking-tight text-white">
            three steps.
            <br />
            <span className="text-white/70">fifteen seconds.</span>
          </h2>
        </div>

        {/* Steps grid — each card has a top border + large number for
            clear structure. High-contrast text throughout, no opacity-based
            "dimness" — premium = legible, not faded. */}
        <div className="grid grid-cols-1 gap-x-10 gap-y-14 md:grid-cols-3">
          {STEPS.map((s) => (
            <div
              key={s.num}
              className="pp-step border-t border-white/40 pt-7"
            >
              {/* Number — prominent, mono, top-aligned */}
              <div
                className="mb-10 text-sm tracking-[0.18em] text-white/85"
                style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
              >
                {s.num}
              </div>
              {/* Kicker */}
              <p className="mb-3 text-xs uppercase tracking-[0.28em] text-white/70">
                {s.kicker}
              </p>
              {/* Title */}
              <h3 className="hero-title mb-5 text-[clamp(28px,3.2vw,40px)] font-medium leading-[1.05] text-white">
                {s.title}
              </h3>
              {/* Body — white/85 reads as crisp white in context */}
              <p className="text-[15.5px] leading-[1.65] text-white/85">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
