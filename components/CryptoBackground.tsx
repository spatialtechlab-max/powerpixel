"use client";

import { useEffect, useRef } from "react";

/**
 * Encrypted-vibe background animation for the Power Pixel Pro hero.
 *
 * Pure-black canvas with falling hex-digit rain (Matrix style, but the
 * alphabet is 0–9 + A–F so it reads as cryptographic hash output rather
 * than pop-katakana). Each column falls at its own speed; a translucent
 * black overlay each frame produces the natural trail-fade. Bright "head"
 * character at the leading edge, recent characters dimmed behind it.
 *
 * Why a Canvas not a stock video:
 *   - 0 KB asset on the wire (the .mp4 was ~10 MB)
 *   - Resolution-independent — looks crisp on any display
 *   - Pure monochrome control, matches brand palette exactly
 *   - ~1–2 % CPU on a modern laptop, well below any video decoder cost
 */
export function CryptoBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const FONT_SIZE = 14;
    const HEX = "0123456789ABCDEF";

    let cols = 0;
    let drops: number[] = [];     // y-position per column
    let speeds: number[] = [];    // pixels-per-frame per column

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(1, 0, 0, 1, 0, 0); // reset before re-scaling
      ctx.scale(dpr, dpr);
      cols = Math.floor(window.innerWidth / FONT_SIZE);
      drops = new Array(cols).fill(0).map(() => Math.random() * window.innerHeight);
      speeds = new Array(cols).fill(0).map(() => 0.5 + Math.random() * 1.7);
    };

    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const draw = () => {
      // Trail fade: thin translucent black redraw each frame.
      ctx.fillStyle = "rgba(0, 0, 0, 0.07)";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

      ctx.font = `${FONT_SIZE}px "JetBrains Mono", ui-monospace, "SF Mono", monospace`;

      for (let i = 0; i < cols; i++) {
        const x = i * FONT_SIZE;
        const y = drops[i];

        // Bright leading head character
        ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
        ctx.fillText(HEX[Math.floor(Math.random() * HEX.length)], x, y);

        // Dimmer second-row character (gives the head a hint of motion blur)
        ctx.fillStyle = "rgba(255, 255, 255, 0.32)";
        ctx.fillText(HEX[Math.floor(Math.random() * HEX.length)], x, y - FONT_SIZE);

        // Advance and reset
        drops[i] += speeds[i] * FONT_SIZE * 0.08;
        if (drops[i] > window.innerHeight + FONT_SIZE * 4 && Math.random() > 0.975) {
          drops[i] = -FONT_SIZE * (Math.random() * 8);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}
