"use client";

/**
 * Power Pixel Pro — /lookup (paid scan flow).
 *
 * Phase progression:
 *   idle              → drop zone
 *   needsWallet       → file picked, wallet not connected → ask to connect
 *   needsPayment      → wallet connected → ask to pay lookup fee
 *   payingLookup      → tx submitted, waiting for confirmation
 *   scanning          → payment confirmed, /api/classify running
 *   done              → verdict; ScanSignPanel handles the attestation payment
 *   error             → terminal error in any stage above
 */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Upload,
  ShieldCheck,
  ShieldAlert,
  RotateCcw,
  AlertCircle,
  Wallet,
  CheckCircle2,
} from "lucide-react";
import { parseEther, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { sepolia } from "wagmi/chains";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  POWERPIXELPRO_ABI,
  PPP_CONTRACT_ADDRESS,
  LOOKUP_FEE_ETH,
  ATTESTATION_FEE_ETH,
  txUrl,
} from "@/lib/contract";
import { sha256OfFile, fileToJpegDataURL } from "@/lib/hash";
import { ScanSignPanel } from "@/components/ScanSignPanel";
import { WalletPill } from "@/components/WalletPill";

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "home", href: "/" },
  { label: "lookup", href: "/lookup" },
  { label: "support", href: "#support" },
];

const BG_VIDEO = "/lookup-bg.mp4";

type Phase =
  | { kind: "idle" }
  | { kind: "needsWallet"; file: File; previewUrl: string }
  | { kind: "needsPayment"; file: File; previewUrl: string }
  | { kind: "payingLookup"; file: File; previewUrl: string; txHash?: Hex }
  | { kind: "scanning"; file: File; previewUrl: string }
  | {
      kind: "done";
      previewUrl: string;
      fileName: string;
      imageHash: Hex;
      imageDataUrl: string;
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

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const onSepolia = chainId === sepolia.id;

  // When wallet state changes, the phase transitions are evaluated in handlers.

  const reset = useCallback(() => {
    if (phase.kind !== "idle" && "previewUrl" in phase && phase.previewUrl) {
      URL.revokeObjectURL(phase.previewUrl);
    }
    setPhase({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }, [phase]);

  const onFile = useCallback(
    (file: File) => {
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

      // Gate: wallet must be connected before paying for lookup.
      if (!isConnected) {
        setPhase({ kind: "needsWallet", file, previewUrl });
        return;
      }
      setPhase({ kind: "needsPayment", file, previewUrl });
    },
    [isConnected]
  );

  // If user lands on `needsWallet` and then connects, advance to needsPayment.
  useEffect(() => {
    if (phase.kind === "needsWallet" && isConnected) {
      setPhase({ kind: "needsPayment", file: phase.file, previewUrl: phase.previewUrl });
    }
  }, [phase, isConnected]);

  const runScan = useCallback(async (file: File, previewUrl: string) => {
    setPhase({ kind: "scanning", file, previewUrl });
    try {
      // Compute hash + normalize to a JPEG data URL for the PDF in parallel.
      const [imageHash, imageDataUrl] = await Promise.all([
        sha256OfFile(file),
        fileToJpegDataURL(file).catch(() => ""), // PDF embed is best-effort
      ]);

      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/classify", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);

      setPhase({
        kind: "done",
        previewUrl,
        fileName: file.name,
        imageHash,
        imageDataUrl,
        verdict: json.verdict,
        reason: json.reason ?? null,
        ai_detected: !!json.ai_detected,
        flags: json.flags ?? { ai: false, brand: false, watermark: false },
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase({ kind: "error", previewUrl, fileName: file.name, message });
    }
  }, []);

  return (
    <main className="relative min-h-screen w-full overflow-hidden text-white">
      <video
        className="fixed inset-0 h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        src={BG_VIDEO}
      />
      <div className="fixed inset-0 bg-black/65" aria-hidden="true" />

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

        <WalletPill />
      </nav>

      <section className="relative z-20 mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-6 pb-16 pt-32 sm:pt-40">
        {phase.kind === "idle" && (
          <>
            <header className="mb-10 text-center">
              <p className="mb-3 text-xs uppercase tracking-[0.28em] text-white/65 sm:text-sm">
                lookup
              </p>
              <h1 className="hero-title text-4xl font-medium tracking-tight sm:text-5xl md:text-6xl">
                Drop an image.
              </h1>
              <p className="mx-auto mt-4 max-w-md text-base text-white/80 sm:text-lg">
                We&apos;ll screen it for AI provenance, brand presence, and hidden
                watermarks. {LOOKUP_FEE_ETH} ETH per scan, verdict in about
                fifteen seconds.
              </p>
            </header>
            <DropZone
              onFile={onFile}
              inputRef={inputRef}
              dragOver={dragOver}
              setDragOver={setDragOver}
            />
          </>
        )}

        {phase.kind === "needsWallet" && (
          <NeedsWalletCard previewUrl={phase.previewUrl} fileName={phase.file.name} onReset={reset} />
        )}

        {phase.kind === "needsPayment" && (
          <NeedsPaymentCard
            previewUrl={phase.previewUrl}
            fileName={phase.file.name}
            onPaid={() => runScan(phase.file, phase.previewUrl)}
            onCancel={reset}
            onSepolia={onSepolia}
            setTxHash={(h) =>
              setPhase({
                kind: "payingLookup",
                file: phase.file,
                previewUrl: phase.previewUrl,
                txHash: h,
              })
            }
          />
        )}

        {phase.kind === "payingLookup" && (
          <PayingLookupCard
            previewUrl={phase.previewUrl}
            fileName={phase.file.name}
            txHash={phase.txHash}
            onConfirmed={() => runScan(phase.file, phase.previewUrl)}
            onFailed={(msg) =>
              setPhase({ kind: "error", previewUrl: phase.previewUrl, fileName: phase.file.name, message: msg })
            }
          />
        )}

        {phase.kind === "scanning" && (
          <ScanningCard previewUrl={phase.previewUrl} fileName={phase.file.name} />
        )}

        {phase.kind === "done" && (
          <ResultCard
            previewUrl={phase.previewUrl}
            fileName={phase.fileName}
            imageHash={phase.imageHash}
            imageDataUrl={phase.imageDataUrl}
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

/* ────────────────────────────────────────────────────────────────────── */

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

function PreviewFrame({ previewUrl, fileName }: { previewUrl: string; fileName: string }) {
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-white/15 backdrop-blur-md">
      <div className="aspect-[16/10] w-full bg-black/40">
        <img src={previewUrl} alt={fileName} className="h-full w-full object-contain" />
      </div>
    </div>
  );
}

function NeedsWalletCard({
  previewUrl,
  fileName,
  onReset,
}: {
  previewUrl: string;
  fileName: string;
  onReset: () => void;
}) {
  return (
    <div className="w-full">
      <PreviewFrame previewUrl={previewUrl} fileName={fileName} />
      <div className="mt-6 rounded-2xl border border-white/15 bg-white/[0.05] p-5 backdrop-blur-md sm:p-6">
        <div className="flex items-start gap-3">
          <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-white/85" />
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.25em] text-white/65">
              connect wallet to scan
            </p>
            <p className="mt-1 text-sm text-white/90 sm:text-base">
              Each scan costs {LOOKUP_FEE_ETH} ETH on Sepolia. Connect your
              wallet to continue.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <ConnectButton.Custom>
                {({ openConnectModal, mounted }) => {
                  if (!mounted) {
                    return <div className="h-10 w-44 rounded-full bg-white/[0.08] animate-pulse" />;
                  }
                  return (
                    <button
                      onClick={openConnectModal}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black hover:bg-neutral-200"
                    >
                      <Wallet className="h-4 w-4" />
                      Connect wallet
                    </button>
                  );
                }}
              </ConnectButton.Custom>
              <button
                onClick={onReset}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.06] px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.10] sm:text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NeedsPaymentCard({
  previewUrl,
  fileName,
  onPaid,
  onCancel,
  onSepolia,
  setTxHash,
}: {
  previewUrl: string;
  fileName: string;
  onPaid: () => void;
  onCancel: () => void;
  onSepolia: boolean;
  setTxHash: (h: Hex) => void;
}) {
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const {
    writeContract,
    data: localTxHash,
    isPending: isSubmitting,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Hoist the tx hash up to the parent so the wait-for-receipt component
  // can poll for confirmation in a stable place.
  useEffect(() => {
    if (localTxHash) setTxHash(localTxHash);
  }, [localTxHash, setTxHash]);

  const contractMissing =
    !PPP_CONTRACT_ADDRESS ||
    PPP_CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000";

  const pay = () => {
    if (!onSepolia) {
      switchChain({ chainId: sepolia.id });
      return;
    }
    resetWrite();
    writeContract({
      address: PPP_CONTRACT_ADDRESS,
      abi: POWERPIXELPRO_ABI,
      functionName: "payForLookup",
      value: parseEther(LOOKUP_FEE_ETH),
    });
  };

  return (
    <div className="w-full">
      <PreviewFrame previewUrl={previewUrl} fileName={fileName} />
      <div className="mt-6 rounded-2xl border border-white/15 bg-white/[0.05] p-5 backdrop-blur-md sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-white/85" />
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.25em] text-white/65">
              pay to scan
            </p>
            <p className="mt-1 text-sm text-white/90 sm:text-base">
              {LOOKUP_FEE_ETH} ETH on Sepolia. We run all five signals
              (provenance, AI, brand, watermark) and return the verdict in
              about fifteen seconds.
            </p>

            {contractMissing && (
              <p className="mt-3 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                Contract address not configured. Set
                <code className="mx-1 rounded bg-black/40 px-1">NEXT_PUBLIC_PPP_CONTRACT_ADDRESS</code>.
              </p>
            )}

            {writeError && (
              <p className="mt-3 rounded-md border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                {humanizeWriteError(writeError.message)}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {!onSepolia ? (
                <button
                  onClick={() => switchChain({ chainId: sepolia.id })}
                  disabled={isSwitching}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-amber-300/50 bg-amber-400/15 px-5 text-sm font-medium text-amber-100 hover:bg-amber-400/25"
                >
                  {isSwitching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  Switch to Sepolia
                </button>
              ) : (
                <button
                  onClick={pay}
                  disabled={isSubmitting || contractMissing}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-60"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Pay {LOOKUP_FEE_ETH} ETH & scan
                </button>
              )}
              <button
                onClick={onCancel}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.06] px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.10] sm:text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Marker — kept for parity with the rest of the layout */}
      <div className="hidden">{String(onPaid)}</div>
    </div>
  );
}

function PayingLookupCard({
  previewUrl,
  fileName,
  txHash,
  onConfirmed,
  onFailed,
}: {
  previewUrl: string;
  fileName: string;
  txHash?: Hex;
  onConfirmed: () => void;
  onFailed: (msg: string) => void;
}) {
  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess,
    isError,
    error,
  } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess && receipt) onConfirmed();
  }, [isSuccess, receipt, onConfirmed]);

  useEffect(() => {
    if (isError && error) onFailed(error.message ?? "Transaction failed.");
  }, [isError, error, onFailed]);

  return (
    <div className="w-full">
      <PreviewFrame previewUrl={previewUrl} fileName={fileName} />
      <div className="mt-6 rounded-2xl border border-white/15 bg-white/[0.05] p-5 backdrop-blur-md sm:p-6">
        <div className="flex items-start gap-3">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-white/90" />
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.25em] text-white/65">
              {isConfirming ? "confirming payment" : "waiting for signature"}
            </p>
            <p className="mt-1 text-sm text-white/90 sm:text-base">
              {isConfirming
                ? "Sepolia is including your payment in a block — usually under 15 seconds."
                : "Approve the transaction in your wallet."}
            </p>
            {txHash && (
              <a
                href={txUrl(txHash)}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-white/65 underline-offset-4 hover:text-white hover:underline"
              >
                Track on Etherscan
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScanningCard({ previewUrl, fileName }: { previewUrl: string; fileName: string }) {
  return (
    <div className="w-full">
      <PreviewFrame previewUrl={previewUrl} fileName={fileName} />
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
  imageHash,
  imageDataUrl,
  verdict,
  reason,
  aiDetected,
  flags,
  onReset,
}: {
  previewUrl: string;
  fileName: string;
  imageHash: Hex;
  imageDataUrl: string;
  verdict: "allow" | "block";
  reason: string | null;
  aiDetected: boolean;
  flags: { ai: boolean; brand: boolean; watermark: boolean };
  onReset: () => void;
}) {
  const isAllowed = verdict === "allow";
  return (
    <div className="w-full">
      <PreviewFrame previewUrl={previewUrl} fileName={fileName} />

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

      {isAllowed && (
        <ScanSignPanel
          imageHash={imageHash}
          imageDataUrl={imageDataUrl}
          verdictReason={reason ?? "Clear to publish."}
          aiDetected={aiDetected}
          brandDetected={flags.brand}
          watermarkDetected={flags.watermark}
          fileName={fileName}
        />
      )}

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
      {previewUrl && <PreviewFrame previewUrl={previewUrl} fileName={fileName} />}
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

function humanizeWriteError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("user rejected") || m.includes("user denied")) {
    return "You declined the signature in your wallet. Try again whenever you're ready.";
  }
  if (m.includes("insufficient funds")) {
    return "Your wallet doesn't have enough Sepolia ETH for the fee + gas. Top it up from a faucet and retry.";
  }
  return msg.split("\n")[0] ?? "Transaction failed. Please try again.";
}

// Used by parent state — preserve unused references so the linter doesn't
// strip them when bundling.
void CheckCircle2;
