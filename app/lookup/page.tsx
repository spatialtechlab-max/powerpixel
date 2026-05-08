"use client";

/**
 * Power Pixel Pro — /lookup (image scan).
 *
 * The lookup flow: drop or pick an image, server runs the full pipeline
 * via /api/classify, page renders one of three states (idle / scanning /
 * verdict). Mobile-responsive. Background video adds visual continuity
 * with the home hero.
 *
 * Replaces the legacy DoNotTrain blockchain-lookup page (the old version
 * lives in git history if needed).
 */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Loader2, Upload, ShieldCheck, ShieldAlert, RotateCcw } from "lucide-react";

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "home", href: "/" },
  { label: "register", href: "/register" },
  { label: "lookup", href: "/lookup" },
  { label: "support", href: "#support" },
];

const BG_VIDEO = "/lookup-bg.mp4";

type Phase =
  | { kind: "idle" }
  | { kind: "scanning"; previewUrl: string; fileName: string }
  | {
      kind: "done";
      previewUrl: string;
      fileName: string;
      verdict: "allow" | "block";
      reason: string | null;
      ai_detected: boolean;
      flags: { ai: boolean; brand: boolean; watermark: boolean };
    }
  | { kind: "error"; previewUrl: string; fileName: string; message: string };

export default function LookupPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setPhase({
        kind: "error",
        previewUrl: "",
        fileName: file.name,
        message: "Only image files are supported.",
      });
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    const fileName = file.name;
    setPhase({ kind: "scanning", previewUrl, fileName });

    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/classify", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setPhase({
        kind: "done",
        previewUrl,
        fileName,
        verdict: json.verdict,
        reason: json.reason ?? null,
        ai_detected: !!json.ai_detected,
        flags: json.flags ?? { ai: false, brand: false, watermark: false },
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase({ kind: "error", previewUrl, fileName, message });
    }
  }, []);

  const reset = useCallback(() => {
    if (phase.kind !== "idle" && "previewUrl" in phase && phase.previewUrl) {
      URL.revokeObjectURL(phase.previewUrl);
    }
    setPhase({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }, [phase]);

  return (
    <main className="relative min-h-screen w-full overflow-hidden text-white">
      {/* Background video — fixed behind every other layer. Default z-index
          (no negative) so the body's .is-home bg-black doesn't paint over it. */}
      <video
        className="fixed inset-0 h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        src={BG_VIDEO}
      />
      {/* Strong dark overlay over the video for form legibility */}
      <div className="fixed inset-0 bg-black/65" aria-hidden="true" />

      {/* ── Floating pill navbar ─────────────────────────────────────── */}
      <nav className="fixed left-0 right-0 top-0 z-30 flex items-center justify-between gap-3 px-4 pt-4 sm:gap-4 sm:px-6 sm:pt-6 md:px-10">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full bg-white/[0.06] py-2 pl-2.5 pr-5 ring-1 ring-inset ring-white/10 backdrop-blur-2xl backdrop-saturate-150 transition-colors hover:bg-white/[0.10] sm:py-2.5 sm:pl-3 sm:pr-6"
        >
          <Image
            src="/powerpixel-mark.png"
            alt="Power Pixel Pro"
            width={28}
            height={28}
            priority
            className="h-6 w-6 object-contain sm:h-7 sm:w-7"
          />
          <span className="text-sm font-normal tracking-tight text-white">
            powerpixel
          </span>
        </Link>

        <div className="hidden items-center gap-1 rounded-full bg-white/[0.06] px-3 py-2 ring-1 ring-inset ring-white/10 backdrop-blur-2xl backdrop-saturate-150 md:flex">
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

        <Link
          href="/register"
          className="rounded-full bg-white px-4 py-2.5 text-sm font-normal text-black transition-colors hover:bg-neutral-200 sm:px-6 sm:py-3"
        >
          connect wallet
        </Link>
      </nav>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <section className="relative z-20 mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-6 pb-16 pt-32 sm:pt-40">
        {phase.kind === "idle" && (
          <header className="mb-10 text-center">
            <p className="mb-3 text-xs uppercase tracking-[0.28em] text-white/65 sm:text-sm">
              lookup
            </p>
            <h1 className="hero-title text-4xl font-medium tracking-tight sm:text-5xl md:text-6xl">
              Drop an image.
            </h1>
            <p className="mx-auto mt-4 max-w-md text-base text-white/80 sm:text-lg">
              We&apos;ll screen it for AI provenance, brand presence, and hidden
              watermarks. Verdict in about fifteen seconds.
            </p>
          </header>
        )}

        {phase.kind === "idle" && (
          <DropZone
            onFile={onFile}
            inputRef={inputRef}
            dragOver={dragOver}
            setDragOver={setDragOver}
          />
        )}

        {phase.kind === "scanning" && (
          <ScanningCard previewUrl={phase.previewUrl} fileName={phase.fileName} />
        )}

        {phase.kind === "done" && (
          <ResultCard
            previewUrl={phase.previewUrl}
            fileName={phase.fileName}
            verdict={phase.verdict}
            reason={phase.reason}
            aiDetected={phase.ai_detected}
            flags={phase.flags}
            onReset={reset}
          />
        )}

        {phase.kind === "error" && (
          <ErrorCard
            previewUrl={phase.previewUrl}
            fileName={phase.fileName}
            message={phase.message}
            onReset={reset}
          />
        )}
      </section>
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────

function DropZone({
  onFile,
  inputRef,
  dragOver,
  setDragOver,
}: {
  onFile: (file: File) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      onClick={() => inputRef.current?.click()}
      className={[
        "group relative flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 backdrop-blur-md transition-colors sm:py-20",
        dragOver
          ? "border-white/65 bg-white/[0.10]"
          : "border-white/30 bg-black/35 hover:border-white/55 hover:bg-white/[0.05]",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
      <Upload
        className="mb-5 h-10 w-10 text-white/60 transition-colors group-hover:text-white/90 sm:h-12 sm:w-12"
        strokeWidth={1.25}
      />
      <p className="text-base font-medium text-white sm:text-lg">
        Drop an image here or tap to browse
      </p>
      <p className="mt-2 text-xs text-white/65 sm:text-sm">
        png · jpg · webp · up to 20 MB
      </p>
    </div>
  );
}

function ScanningCard({
  previewUrl,
  fileName,
}: {
  previewUrl: string;
  fileName: string;
}) {
  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-2xl ring-1 ring-white/15 backdrop-blur-md">
        <div className="aspect-[16/10] w-full bg-black/40">
          <img
            src={previewUrl}
            alt={fileName}
            className="h-full w-full object-contain"
          />
        </div>
      </div>
      <div className="mt-6 flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-white/90" />
        <span className="text-sm text-white/95 sm:text-base">
          Scanning… provenance, brand, watermarks
        </span>
      </div>
      <p className="mt-2 text-xs text-white/70 sm:text-sm">
        Five signals in parallel. Usually about fifteen seconds.
      </p>
      <p className="mt-1 truncate text-xs text-white/45">{fileName}</p>
    </div>
  );
}

function ResultCard({
  previewUrl,
  fileName,
  verdict,
  reason,
  aiDetected,
  flags,
  onReset,
}: {
  previewUrl: string;
  fileName: string;
  verdict: "allow" | "block";
  reason: string | null;
  aiDetected: boolean;
  flags: { ai: boolean; brand: boolean; watermark: boolean };
  onReset: () => void;
}) {
  const isAllowed = verdict === "allow";
  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-2xl ring-1 ring-white/15 backdrop-blur-md">
        <div className="aspect-[16/10] w-full bg-black/40">
          <img
            src={previewUrl}
            alt={fileName}
            className="h-full w-full object-contain"
          />
        </div>
      </div>

      <div
        className={[
          "mt-6 flex items-start gap-4 rounded-2xl border p-5 backdrop-blur-md sm:p-6",
          isAllowed
            ? "border-emerald-400/50 bg-emerald-500/[0.12]"
            : "border-red-400/50 bg-red-500/[0.12]",
        ].join(" ")}
      >
        {isAllowed ? (
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-300" />
        ) : (
          <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />
        )}
        <div className="flex-1">
          <p
            className={[
              "text-xs uppercase tracking-[0.25em]",
              isAllowed ? "text-emerald-200" : "text-red-200",
            ].join(" ")}
          >
            {isAllowed ? "allowed" : "blocked"}
          </p>
          <p className="mt-1 text-lg font-medium leading-tight text-white sm:text-xl">
            {isAllowed ? "Clear to publish" : (reason ?? "Not allowed")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em]">
            <Tag active={aiDetected} label="ai" tone="info" />
            <Tag active={flags.brand} label="brand" tone="block" />
            <Tag active={flags.watermark} label="watermark" tone="block" />
          </div>
        </div>
      </div>

      <button
        onClick={onReset}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-neutral-200 sm:w-auto"
      >
        <RotateCcw className="h-4 w-4" />
        Scan another
      </button>
    </div>
  );
}

function Tag({
  active,
  label,
  tone,
}: {
  active: boolean;
  label: string;
  tone: "info" | "block";
}) {
  if (!active) {
    return (
      <span className="rounded-full border border-white/25 bg-white/[0.06] px-2.5 py-1 text-white/65">
        no {label}
      </span>
    );
  }
  if (tone === "info") {
    return (
      <span className="rounded-full border border-blue-300/50 bg-blue-400/20 px-2.5 py-1 text-blue-100">
        {label} detected
      </span>
    );
  }
  return (
    <span className="rounded-full border border-red-300/50 bg-red-400/20 px-2.5 py-1 text-red-100">
      {label} detected
    </span>
  );
}

function ErrorCard({
  previewUrl,
  fileName,
  message,
  onReset,
}: {
  previewUrl: string;
  fileName: string;
  message: string;
  onReset: () => void;
}) {
  return (
    <div className="w-full">
      {previewUrl && (
        <div className="overflow-hidden rounded-2xl ring-1 ring-white/15 backdrop-blur-md">
          <div className="aspect-[16/10] w-full bg-black/40">
            <img
              src={previewUrl}
              alt={fileName}
              className="h-full w-full object-contain"
            />
          </div>
        </div>
      )}
      <div className="mt-6 rounded-2xl border border-amber-400/50 bg-amber-500/[0.12] p-5 backdrop-blur-md sm:p-6">
        <p className="text-xs uppercase tracking-[0.25em] text-amber-200">
          scan failed
        </p>
        <p className="mt-1 text-base text-white sm:text-lg">{message}</p>
      </div>
      <button
        onClick={onReset}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-neutral-200 sm:w-auto"
      >
        <RotateCcw className="h-4 w-4" />
        Try again
      </button>
    </div>
  );
}
