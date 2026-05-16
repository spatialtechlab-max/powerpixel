#!/usr/bin/env node
/**
 * Generate a sample Power Pixel Pro receipt PDF (no wallet, no chain).
 *
 * Mirrors the layout in lib/pppPdf.ts but in a Node-only flavour so we
 * can preview the design without running through the full scan flow.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { jsPDF } from "jspdf";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 60;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const LABEL_W = 160;
const VALUE_X = MARGIN_X + LABEL_W;
const VALUE_W = CONTENT_W - LABEL_W;

const C = {
  ink: [16, 18, 24],
  body: [60, 64, 72],
  muted: [120, 124, 132],
  rule: [220, 222, 226],
  okBg: [232, 246, 236],
  okInk: [25, 95, 55],
  blockBg: [252, 232, 232],
  blockInk: [140, 30, 30],
  imageBg: [245, 246, 248],
};

const SAMPLE = {
  imageHash: "0x" + "a1b2c3d4".repeat(8),
  imagePath: path.join(PROJECT_ROOT, "public", "step-1.jpg"),
  fileName: "preandpast.png",
  verdictReason: "Clear to publish.",
  aiDetected: false,
  brandDetected: false,
  watermarkDetected: false,
  attestor: "0xb29E29aF3346Dd0E88Ad1dDD2c5634910243152A",
  blockNumber: 8456712,
  timestamp: Math.floor(Date.now() / 1000),
  txHash: "0x" + "1f2e3d4c".repeat(8),
};

async function loadImageDataURL(filePath) {
  const buf = await sharp(filePath)
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}` };
}

async function getImageDimensions(filePath) {
  const meta = await sharp(filePath).metadata();
  return { width: meta.width, height: meta.height };
}

function loadLogoDataURL() {
  const p = path.join(PROJECT_ROOT, "public", "powerpixel-mark.png");
  if (!fs.existsSync(p)) return null;
  return `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
}

function txUrl(hash) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}
function addressUrl(addr) {
  return `https://sepolia.etherscan.io/address/${addr}`;
}

function rule(doc, y) {
  doc.setDrawColor(...C.rule);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
}

function sectionHeader(doc, y, label) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(label.toUpperCase(), MARGIN_X, y, { charSpace: 1.2 });
  return y + 22;
}

function wrapUrlAtSlashes(doc, url, maxWidth) {
  const parts = url.split(/(\/)/);
  const lines = [];
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

function renderRow(doc, y, label, value, kind) {
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

function pageFooter(doc, page, total) {
  const footerY = PAGE_H - 36;
  rule(doc, footerY - 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  doc.text("Power Pixel Pro  ·  Pre-publish image scan", MARGIN_X, footerY);
  doc.text(`Page ${page} of ${total}`, PAGE_W - MARGIN_X, footerY, { align: "right" });
}

function brandHeader(doc, y, mark, tag) {
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

async function main() {
  const d = SAMPLE;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const isBlocked = d.brandDetected || d.watermarkDetected;
  const mark = loadLogoDataURL();

  /* ═══ Page 1 ═══ */
  let y = brandHeader(doc, 60, mark, "SCAN ATTESTATION");
  y += 28;

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

  // SCANNED IMAGE
  y = sectionHeader(doc, y, "Scanned image");
  y += 4;

  const { dataUrl: imageDataUrl } = await loadImageDataURL(d.imagePath);
  const { width: natW, height: natH } = await getImageDimensions(d.imagePath);

  const maxBoxW = CONTENT_W;
  const maxBoxH = 270;
  const scale = Math.min(maxBoxW / natW, maxBoxH / natH);
  const w = natW * scale;
  const h = natH * scale;
  const boxH = maxBoxH;
  const x = MARGIN_X + (maxBoxW - w) / 2;
  const yImg = y + (boxH - h) / 2;

  doc.setFillColor(...C.imageBg);
  doc.roundedRect(MARGIN_X, y, maxBoxW, boxH, 6, 6, "F");
  doc.addImage(imageDataUrl, "JPEG", x, yImg, w, h);
  y += boxH;

  y += 8;
  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  doc.text(d.fileName, MARGIN_X, y);
  y += 6;
  y += 18;

  // VERDICT BANNER
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

  // SCAN SIGNALS
  y = sectionHeader(doc, y, "Scan signals");
  y += 4;
  const flagText = (b) => (b ? "Detected" : "Not detected");
  y = renderRow(doc, y, "AI provenance", flagText(d.aiDetected), "text");
  y = renderRow(doc, y, "Brand presence", flagText(d.brandDetected), "text");
  y = renderRow(doc, y, "Watermark", flagText(d.watermarkDetected), "text");

  pageFooter(doc, 1, 2);

  /* ═══ Page 2 ═══ */
  doc.addPage();
  let y2 = brandHeader(doc, 60, mark, "ON-CHAIN RECORD");
  y2 += 26;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...C.ink);
  doc.text("Transaction details", MARGIN_X, y2);
  y2 += 22;

  const tsNum = Number(d.timestamp);
  const date = new Date(tsNum * 1000);
  const blockNum = String(d.blockNumber);

  const rows = [
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

  y2 = sectionHeader(doc, y2, "Registry contract");
  y2 += 4;
  const PPP_CONTRACT = "0xA254a1A5743448DCDfe8d19699A9d027D2199752";
  y2 = renderRow(doc, y2, "Contract", PPP_CONTRACT, "mono");
  y2 = renderRow(doc, y2, "Network", "Ethereum Sepolia testnet (chainId 11155111)", "text");
  y2 = renderRow(doc, y2, "View on Etherscan", addressUrl(PPP_CONTRACT), "url");

  y2 += 26;
  rule(doc, y2);
  y2 += 22;

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

  const outPath = path.join(PROJECT_ROOT, "sample-ppp-receipt.pdf");
  fs.writeFileSync(outPath, Buffer.from(doc.output("arraybuffer")));
  console.log(`Wrote ${outPath}`);

  if (process.platform === "darwin") {
    exec(`open "${outPath}"`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
