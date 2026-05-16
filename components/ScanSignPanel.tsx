"use client";

/**
 * Power Pixel Pro — on-chain attestation panel.
 *
 * Renders inside the /lookup verdict card after a scan completes.
 * Connects the user's wallet, calls registerScan() on the Power Pixel
 * Pro contract with the image hash + verdict flags, then downloads a
 * Power Pixel Pro evidence PDF once the tx confirms.
 *
 * Standalone from DoNotTrain — uses its own ABI (POWERPIXELPRO_ABI),
 * its own address (PPP_CONTRACT_ADDRESS), its own PDF generator
 * (lib/pppPdf). Shares only wagmi/RainbowKit plumbing.
 */

import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { sepolia } from "wagmi/chains";
import { parseEther } from "viem";
import {
  PPP_CONTRACT_ADDRESS,
  POWERPIXELPRO_ABI,
  ATTESTATION_FEE_ETH,
  txUrl,
} from "@/lib/contract";
import { downloadScanReceiptPDF } from "@/lib/pppPdf";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  AlertCircle,
  FileDown,
  ShieldCheck,
} from "lucide-react";

export interface ScanSignPanelProps {
  imageHash: `0x${string}`;
  imageDataUrl?: string;
  verdictReason: string;
  aiDetected: boolean;
  brandDetected: boolean;
  watermarkDetected: boolean;
  fileName?: string;
}

export function ScanSignPanel({
  imageHash,
  imageDataUrl,
  verdictReason,
  aiDetected,
  brandDetected,
  watermarkDetected,
  fileName,
}: ScanSignPanelProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const onSepolia = chainId === sepolia.id;

  const {
    writeContract,
    data: txHash,
    isPending: isSubmitting,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const [pdfDownloaded, setPdfDownloaded] = useState(false);

  // Once the transaction confirms, download the receipt PDF automatically.
  useEffect(() => {
    if (!isConfirmed || !receipt || pdfDownloaded || !address) return;
    setPdfDownloaded(true);
    downloadScanReceiptPDF({
      imageHash,
      imageDataUrl,
      fileName,
      verdictReason,
      aiDetected,
      brandDetected,
      watermarkDetected,
      attestor: address,
      blockNumber: receipt.blockNumber,
      timestamp: Math.floor(Date.now() / 1000),
      txHash: receipt.transactionHash,
    }).catch((e) => {
      console.error("Failed to generate scan receipt PDF:", e);
    });
  }, [
    isConfirmed,
    receipt,
    pdfDownloaded,
    address,
    imageHash,
    imageDataUrl,
    fileName,
    verdictReason,
    aiDetected,
    brandDetected,
    watermarkDetected,
  ]);

  const onSign = () => {
    if (!onSepolia) {
      switchChain({ chainId: sepolia.id });
      return;
    }
    resetWrite();
    setPdfDownloaded(false);
    writeContract({
      address: PPP_CONTRACT_ADDRESS,
      abi: POWERPIXELPRO_ABI,
      functionName: "registerScan",
      args: [
        imageHash,
        verdictReason,
        aiDetected,
        brandDetected,
        watermarkDetected,
      ],
      value: parseEther(ATTESTATION_FEE_ETH),
    });
  };

  const contractMissing = useMemo(
    () =>
      !PPP_CONTRACT_ADDRESS ||
      PPP_CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000",
    []
  );

  // Sign panel is not shown for BLOCKED verdicts upstream, but defend in depth.
  // Also short-circuit if the contract address hasn't been wired up yet.
  if (contractMissing) {
    return (
      <div className="mt-6 rounded-2xl border border-amber-400/50 bg-amber-500/[0.10] p-5 backdrop-blur-md sm:p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-amber-200">
              not deployed yet
            </p>
            <p className="mt-1 text-sm text-white/90 sm:text-base">
              On-chain attestation is offline. The Power Pixel Pro contract
              has not been deployed to this environment.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Already confirmed: success state ───────────────────────────────── */
  if (isConfirmed && txHash) {
    return (
      <div className="mt-6 rounded-2xl border border-emerald-400/50 bg-emerald-500/[0.10] p-5 backdrop-blur-md sm:p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-300" />
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.25em] text-emerald-200">
              attested on-chain
            </p>
            <p className="mt-1 text-base font-medium text-white sm:text-lg">
              Saved to Ethereum Sepolia
            </p>
            <p className="mt-1 text-xs text-white/70 sm:text-sm">
              Evidence PDF has been downloaded.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a
                href={txUrl(txHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.06] px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.10] sm:text-sm"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View on Etherscan
              </a>
              <button
                onClick={() => {
                  if (!receipt || !address) return;
                  setPdfDownloaded(true);
                  downloadScanReceiptPDF({
                    imageHash,
                    imageDataUrl,
                    fileName,
                    verdictReason,
                    aiDetected,
                    brandDetected,
                    watermarkDetected,
                    attestor: address,
                    blockNumber: receipt.blockNumber,
                    timestamp: Math.floor(Date.now() / 1000),
                    txHash: receipt.transactionHash,
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.06] px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.10] sm:text-sm"
              >
                <FileDown className="h-3.5 w-3.5" />
                Re-download PDF
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Submitting or confirming ───────────────────────────────────────── */
  if (isSubmitting || isConfirming) {
    return (
      <div className="mt-6 rounded-2xl border border-white/15 bg-white/[0.06] p-5 backdrop-blur-md sm:p-6">
        <div className="flex items-start gap-3">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-white/90" />
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-white/65">
              {isSubmitting ? "waiting for signature" : "confirming on-chain"}
            </p>
            <p className="mt-1 text-sm text-white/90 sm:text-base">
              {isSubmitting
                ? "Approve the transaction in your wallet."
                : "Sepolia is including the transaction in a block."}
            </p>
            {txHash && (
              <a
                href={txUrl(txHash)}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-white/65 underline-offset-4 hover:text-white hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Track the transaction
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── Write error ───────────────────────────────────────────────────── */
  if (writeError) {
    return (
      <div className="mt-6 rounded-2xl border border-red-400/50 bg-red-500/[0.10] p-5 backdrop-blur-md sm:p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.25em] text-red-200">
              signature rejected
            </p>
            <p className="mt-1 text-sm text-white/90 sm:text-base">
              {humanizeWriteError(writeError.message)}
            </p>
            <button
              onClick={() => {
                resetWrite();
                onSign();
              }}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-medium text-black hover:bg-neutral-200 sm:text-sm"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Ready to sign ─────────────────────────────────────────────────── */
  return (
    <div className="mt-6 rounded-2xl border border-white/15 bg-white/[0.05] p-5 backdrop-blur-md sm:p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-white/85" />
        <div className="flex-1">
          <p className="text-xs uppercase tracking-[0.25em] text-white/65">
            register on ethereum
          </p>
          <p className="mt-1 text-sm text-white/90 sm:text-base">
            Anchor this scan result on the Ethereum Sepolia testnet for
            {" "}{ATTESTATION_FEE_ETH} ETH. You get a permanent, verifiable
            record and a downloadable evidence PDF.
          </p>
          <div className="mt-4">
            {!isConnected ? (
              <ConnectButton.Custom>
                {({ openConnectModal, mounted }) => {
                  if (!mounted) {
                    return (
                      <div className="h-10 w-44 rounded-full bg-white/[0.08] animate-pulse" />
                    );
                  }
                  return (
                    <button
                      onClick={openConnectModal}
                      className="inline-flex h-10 items-center justify-center rounded-full bg-white px-5 text-sm font-medium text-black hover:bg-neutral-200"
                    >
                      Connect wallet to register
                    </button>
                  );
                }}
              </ConnectButton.Custom>
            ) : !onSepolia ? (
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
                onClick={onSign}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black hover:bg-neutral-200"
              >
                <ShieldCheck className="h-4 w-4" />
                Pay {ATTESTATION_FEE_ETH} ETH & register
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function humanizeWriteError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("user rejected") || m.includes("user denied")) {
    return "You declined the signature in your wallet. Try again whenever you're ready.";
  }
  if (m.includes("insufficient funds")) {
    return "Your wallet doesn't have enough Sepolia ETH for gas. Top it up from a faucet and retry.";
  }
  if (m.includes("nonce")) {
    return "Wallet nonce mismatch — usually fixed by reloading the page or resetting the account in MetaMask.";
  }
  // Fall back to the first line of the raw error so the user can copy it
  return msg.split("\n")[0] ?? "Transaction failed. Please try again.";
}
