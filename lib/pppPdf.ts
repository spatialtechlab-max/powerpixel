import { jsPDF } from "jspdf";
import { PPP_CONTRACT_ADDRESS, addressUrl, txUrl } from "./contract";

/**
 * Power Pixel Pro — scan attestation PDF.
 *
 * Two-page layout:
 *   Page 1: header, title, scanned image, verdict banner, scan signals
 *   Page 2: on-chain record, verification, registry contract, legal
 *
 * Standalone from DoNotTrain's evidence PDF: different brand, different
 * fields (no pHash, no "do not train" framing — this is a pre-publish IP
 * scan attestation, not an opt-out registry record).
 */
export interface ScanReceiptData {
  imageHash: string;            // SHA-256 of image bytes, 0x-prefixed
  imageDataUrl?: string;        // JPEG data URL of the scanned image (for embedding)
  fileName?: string;
  verdictReason: string;
  aiDetected: boolean;
  brandDetected: boolean;
  watermarkDetected: boolean;
  attestor: string;
  blockNumber: bigint | number;
  timestamp: bigint | number;
  txHash: string;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 60;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const LABEL_W = 160;
const VALUE_X = MARGIN_X + LABEL_W;
const VALUE_W = CONTENT_W - LABEL_W;

const C = {
  ink: [16, 18, 24] as const,
  body: [60, 64, 72] as const,
  muted: [120, 124, 132] as const,
  rule: [220, 222, 226] as const,
  okBg: [232, 246, 236] as const,
  okInk: [25, 95, 55] as const,
  blockBg: [252, 232, 232] as const,
  blockInk: [140, 30, 30] as const,
  imageBg: [245, 246, 248] as const,
};

async function loadMarkDataURL(): Promise<string | null> {
  try {
    const res = await fetch("/powerpixel-mark.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Load an image data URL into an HTMLImageElement to read its natural size. */
async function getImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export async function downloadScanReceiptPDF(d: ScanReceiptData) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const isBlocked = d.brandDetected || d.watermarkDetected;

  const mark = await loadMarkDataURL();

  /* ═══════════════════ PAGE 1 — overview + image ═══════════════════ */
  let y = brandHeader(doc, 60, mark, "SCAN ATTESTATION");
  y += 28;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...C.ink);
  doc.text("Pre-publish Scan Receipt", MARGIN_X, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...C.muted);
  doc.text(
    "On-chain record of an image scan · Ethereum Sepolia testnet",
    MARGIN_X,
    y
  );
  y += 8;

  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  doc.text(`Generated  ${new Date().toUTCString()}`, PAGE_W - MARGIN_X, y, {
    align: "right",
  });
  y += 24;

  /* ────── SCANNED IMAGE ────── */
  if (d.imageDataUrl) {
    y = sectionHeader(doc, y, "Scanned image");
    y += 4;

    const maxBoxW = CONTENT_W;
    const maxBoxH = 270;

    try {
      const { width: natW, height: natH } = await getImageDimensions(
        d.imageDataUrl
      );
      const scale = Math.min(maxBoxW / natW, maxBoxH / natH);
      const w = natW * scale;
      const h = natH * scale;
      const boxH = maxBoxH;
      const x = MARGIN_X + (maxBoxW - w) / 2;
      const yImg = y + (boxH - h) / 2;

      // Subtle backdrop so the image always sits in a defined frame
      doc.setFillColor(...C.imageBg);
      doc.roundedRect(MARGIN_X, y, maxBoxW, boxH, 6, 6, "F");

      doc.addImage(d.imageDataUrl, "JPEG", x, yImg, w, h);
      y += boxH;
    } catch {
      // Fall back to a placeholder if the image can't be loaded
      doc.setFillColor(...C.imageBg);
      doc.roundedRect(MARGIN_X, y, maxBoxW, 80, 6, 6, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...C.muted);
      doc.text(
        "Image preview unavailable.",
        MARGIN_X + maxBoxW / 2,
        y + 48,
        { align: "center" }
      );
      y += 80;
    }

    if (d.fileName) {
      y += 8;
      doc.setFont("courier", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text(d.fileName, MARGIN_X, y);
      y += 6;
    }
    y += 18;
  }

  /* ────── VERDICT BANNER ────── */
  const bannerH = 56;
  const [bgR, bgG, bgB] = isBlocked ? C.blockBg : C.okBg;
  const [inkR, inkG, inkB] = isBlocked ? C.blockInk : C.okInk;

  doc.setFillColor(bgR, bgG, bgB);
  doc.roundedRect(MARGIN_X, y, CONTENT_W, bannerH, 6, 6, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(inkR, inkG, inkB);
  doc.text(
    isBlocked ? "VERDICT  ·  BLOCKED" : "VERDICT  ·  ALLOWED",
    MARGIN_X + 18,
    y + 20,
    { charSpace: 1.2 }
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...C.ink);
  const verdictText = isBlocked
    ? d.verdictReason || "Not allowed"
    : "Clear to publish";
  doc.text(verdictText, MARGIN_X + 18, y + 40, {
    maxWidth: CONTENT_W - 36,
  });

  y += bannerH + 28;

  /* ────── SCAN SIGNALS ────── */
  y = sectionHeader(doc, y, "Scan signals");
  y += 4;
  y = renderRow(doc, y, "AI provenance", flagText(d.aiDetected), "text");
  y = renderRow(doc, y, "Brand presence", flagText(d.brandDetected), "text");
  y = renderRow(doc, y, "Watermark", flagText(d.watermarkDetected), "text");

  // Footer for page 1
  pageFooter(doc, 1, 2);

  /* ═══════════════════ PAGE 2 — on-chain record ═══════════════════ */
  doc.addPage();
  let y2 = brandHeader(doc, 60, mark, "ON-CHAIN RECORD");
  y2 += 26;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...C.ink);
  doc.text("Transaction details", MARGIN_X, y2);
  y2 += 22;

  const tsNum = typeof d.timestamp === "bigint" ? Number(d.timestamp) : d.timestamp;
  const date = new Date(tsNum * 1000);
  const blockNum =
    typeof d.blockNumber === "bigint" ? d.blockNumber.toString() : `${d.blockNumber}`;

  const rows: Array<[string, string, "mono" | "text" | "url"]> = [
    ["Image SHA-256", d.imageHash, "mono"],
    ["Attestor address", d.attestor, "mono"],
    ["Block number", blockNum, "mono"],
    ["Timestamp (UTC)", date.toUTCString(), "text"],
    ["Timestamp (local)", date.toString(), "text"],
    ["Transaction hash", d.txHash, "mono"],
    ["View on Etherscan", txUrl(d.txHash), "url"],
  ];
  for (const [label, value, kind] of rows) {
    y2 = renderRow(doc, y2, label, value, kind);
  }

  y2 += 14;
  rule(doc, y2);
  y2 += 26;

  /* ────── HOW TO VERIFY ────── */
  y2 = sectionHeader(doc, y2, "How to verify");
  y2 += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...C.body);
  const verify =
    "Open the Etherscan transaction URL above. The block timestamp is set by " +
    "Ethereum consensus, not by the issuer of this PDF. The on-chain record " +
    "proves the attestor submitted this verdict for this exact image at this " +
    "block — independently verifiable by anyone, no trust in Power Pixel Pro " +
    "required.";
  const verifyLines = doc.splitTextToSize(verify, CONTENT_W);
  doc.text(verifyLines, MARGIN_X, y2);
  y2 += verifyLines.length * 14 + 22;

  rule(doc, y2);
  y2 += 26;

  /* ────── REGISTRY CONTRACT ────── */
  y2 = sectionHeader(doc, y2, "Registry contract");
  y2 += 4;
  y2 = renderRow(doc, y2, "Contract", PPP_CONTRACT_ADDRESS, "mono");
  y2 = renderRow(doc, y2, "Network", "Ethereum Sepolia testnet (chainId 11155111)", "text");
  y2 = renderRow(doc, y2, "View on Etherscan", addressUrl(PPP_CONTRACT_ADDRESS), "url");

  y2 += 26;
  rule(doc, y2);
  y2 += 22;

  /* ────── LEGAL ────── */
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  const legal =
    "This document is not legal advice. The Power Pixel Pro pre-publish scan " +
    "is a screening tool; it does not adjudicate intellectual property rights. " +
    "Consult qualified counsel for use in any formal proceeding.";
  const legalLines = doc.splitTextToSize(legal, CONTENT_W);
  doc.text(legalLines, MARGIN_X, y2);

  pageFooter(doc, 2, 2);

  doc.save(`powerpixel-scan-${d.imageHash.slice(2, 10)}.pdf`);
}

/* ════════════════ helpers ════════════════ */

function brandHeader(
  doc: jsPDF,
  y: number,
  mark: string | null,
  tag: string
): number {
  if (mark) {
    try {
      doc.addImage(mark, "PNG", MARGIN_X, y - 4, 26, 26);
    } catch {
      /* ignore */
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C.ink);
  doc.setFontSize(14);
  doc.text("Power Pixel Pro", MARGIN_X + (mark ? 36 : 0), y + 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(tag, PAGE_W - MARGIN_X, y + 12, { align: "right" });

  const ruleY = y + 32;
  rule(doc, ruleY);
  return ruleY;
}

function flagText(b: boolean): string {
  return b ? "Detected" : "Not detected";
}

function rule(doc: jsPDF, y: number) {
  doc.setDrawColor(...C.rule);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
}

function sectionHeader(doc: jsPDF, y: number, label: string): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(label.toUpperCase(), MARGIN_X, y, { charSpace: 1.2 });
  return y + 22;
}

function renderRow(
  doc: jsPDF,
  y: number,
  label: string,
  value: string,
  kind: "mono" | "text" | "url"
): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  doc.text(label.toUpperCase(), MARGIN_X, y + 10);

  if (kind === "mono" || kind === "url") {
    doc.setFont("courier", "normal");
    doc.setFontSize(9);
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
  }
  doc.setTextColor(...C.ink);

  const lines =
    kind === "url"
      ? wrapUrlAtSlashes(doc, value, VALUE_W)
      : doc.splitTextToSize(value, VALUE_W);
  doc.text(lines, VALUE_X, y + 10);

  const lineHeight = kind === "mono" || kind === "url" ? 12 : 14;
  return y + Math.max(26, lines.length * lineHeight + 10);
}

function wrapUrlAtSlashes(doc: jsPDF, url: string, maxWidth: number): string[] {
  const parts = url.split(/(\/)/);
  const lines: string[] = [];
  let current = "";
  for (const part of parts) {
    const candidate = current + part;
    if (doc.getTextWidth(candidate) > maxWidth && current) {
      lines.push(current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.flatMap((l) =>
    doc.getTextWidth(l) > maxWidth ? doc.splitTextToSize(l, maxWidth) : [l]
  );
}

function pageFooter(doc: jsPDF, page: number, total: number) {
  const footerY = PAGE_H - 36;
  rule(doc, footerY - 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  doc.text("Power Pixel Pro  ·  Pre-publish image scan", MARGIN_X, footerY);
  doc.text(`Page ${page} of ${total}`, PAGE_W - MARGIN_X, footerY, {
    align: "right",
  });
}
