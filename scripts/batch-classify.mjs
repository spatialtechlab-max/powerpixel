// Batch AI-detection over a directory of images. Runs both signals
// (C2PA Content Credentials + pixel classifier) the same way
// lib/aiDetect.ts runs them in the browser, and emits a PDF report with
// each image embedded next to its verdict.
//
// Run:
//   node scripts/batch-classify.mjs <input-dir> [output.pdf]

import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";
import { pipeline, env } from "@huggingface/transformers";
import { Reader } from "@contentauth/c2pa-node";

// ── Detection logic — mirrors lib/aiDetect.ts ──────────────────────────────

const PIXEL_MODEL = "Organika/sdxl-detector";
const AI_THRESHOLD = 0.4;

const AI_GENERATOR_NEEDLES = [
  "dall","openai","chatgpt","sora","firefly","adobe firefly","imagen",
  "midjourney","stable diffusion","stability","sdxl","flux","bing image creator",
  "veo","runway","leonardo","ideogram","playground","nightcafe","gpt",
];

const AI_DIGITAL_SOURCE_NEEDLES = [
  "trainedalgorithmicmedia","trainedalgorithmicdata",
  "compositewithtrainedalgorithmicmedia","algorithmicmedia",
  "algorithmicallyenhanced","compositesynthetic","datadrivenmedia",
];

function mimeFromExt(p) {
  const e = extname(p).slice(1).toLowerCase();
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "heic" || e === "heif") return "image/heif";
  return null;
}

function scanManifestStore(store) {
  if (!store?.manifests) return { found: false, isAI: false, generator: null, digitalSourceType: null };
  const manifests = Object.values(store.manifests);
  if (manifests.length === 0) return { found: false, isAI: false, generator: null, digitalSourceType: null };

  const active = store.active_manifest ? store.manifests[store.active_manifest] : null;
  const prettyGenerator =
    active?.claim_generator ||
    active?.claim_generator_info?.[0]?.name ||
    manifests[0]?.claim_generator ||
    manifests[0]?.claim_generator_info?.[0]?.name ||
    null;

  let generatorMatch = null;
  let digitalSource = null;

  for (const m of manifests) {
    const blob = [
      m.claim_generator ?? "",
      ...(m.claim_generator_info ?? []).map((g) => g?.name ?? ""),
    ].join(" ").toLowerCase();
    if (!generatorMatch) {
      const hit = AI_GENERATOR_NEEDLES.find((n) => blob.includes(n));
      if (hit) generatorMatch = hit;
    }
    for (const a of m.assertions ?? []) {
      if (!/c2pa\.actions/.test(a.label ?? "")) continue;
      for (const action of a.data?.actions ?? []) {
        const dst = (action.digitalSourceType ?? "").toLowerCase();
        if (AI_DIGITAL_SOURCE_NEEDLES.some((n) => dst.includes(n))) {
          digitalSource = action.digitalSourceType;
          break;
        }
      }
      if (digitalSource) break;
    }
    if (generatorMatch && digitalSource) break;
  }

  return { found: true, isAI: !!generatorMatch || !!digitalSource, generator: prettyGenerator, digitalSourceType: digitalSource };
}

async function readC2pa(filePath, mime) {
  try {
    const bytes = await readFile(filePath);
    const reader = await Reader.fromAsset({ mimeType: mime, buffer: bytes });
    if (!reader) return { found: false, isAI: false, generator: null, digitalSourceType: null };
    const store = reader.json();
    return scanManifestStore(store);
  } catch (e) {
    return { found: false, isAI: false, generator: null, digitalSourceType: null, error: e?.message };
  }
}

async function runPixel(classifier, filePath) {
  const out = await classifier(filePath);
  const aiHit = out.find((r) => /artificial|^ai$|generated|synthetic|fake|deepfake/i.test(r.label));
  if (aiHit) return { score: aiHit.score, label: aiHit.label, raw: out };
  const top = [...out].sort((a, b) => b.score - a.score)[0];
  if (!top) return { score: 0, label: "unknown", raw: out };
  if (/human|real|natural|authentic|photo/i.test(top.label)) {
    return { score: 1 - top.score, label: `inverse(${top.label})`, raw: out };
  }
  return { score: top.score, label: top.label, raw: out };
}

async function detect(classifier, filePath, mime) {
  const c2pa = await readC2pa(filePath, mime);
  if (c2pa.isAI) {
    return {
      verdict: "ai", reason: "c2pa",
      classifierScore: null, classifierLabel: null,
      c2pa, reasonsText: [
        c2pa.generator ? `C2PA manifest declares generator ${c2pa.generator}.` : null,
        c2pa.digitalSourceType ? `digitalSourceType ${c2pa.digitalSourceType} (IPTC AI vocabulary).` : null,
      ].filter(Boolean),
    };
  }
  const pix = await runPixel(classifier, filePath);
  if (pix.score >= AI_THRESHOLD) {
    return {
      verdict: "ai", reason: "pixel",
      classifierScore: pix.score, classifierLabel: pix.label,
      c2pa, reasonsText: [
        `Pixel classifier returned ${(pix.score * 100).toFixed(1)}% AI confidence (threshold ${AI_THRESHOLD * 100}%).`,
        c2pa.found ? "C2PA manifest present but did not declare AI authorship." : null,
      ].filter(Boolean),
    };
  }
  return {
    verdict: "human", reason: "below-threshold",
    classifierScore: pix.score, classifierLabel: pix.label,
    c2pa, reasonsText: [],
  };
}

// ── Driver ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("usage: node scripts/batch-classify.mjs <input-dir> [output.pdf]");
  process.exit(2);
}
const inputDir = resolve(args[0]);
const outPdf = resolve(args[1] || "AI-Classification-Report.pdf");

env.allowLocalModels = false;
env.useBrowserCache = false;

process.stderr.write(`[1/3] loading ${PIXEL_MODEL}…\n`);
const classifier = await pipeline("image-classification", PIXEL_MODEL);

process.stderr.write(`[2/3] scanning ${inputDir}…\n`);
const entries = (await readdir(inputDir, { withFileTypes: true }))
  .filter((d) => d.isFile())
  .map((d) => join(inputDir, d.name))
  .filter((p) => mimeFromExt(p))
  .sort();
process.stderr.write(`     ${entries.length} images found\n`);

const results = [];
for (let i = 0; i < entries.length; i++) {
  const p = entries[i];
  const mime = mimeFromExt(p);
  process.stderr.write(`     [${i + 1}/${entries.length}] ${basename(p)}…`);
  try {
    const r = await detect(classifier, p, mime);
    results.push({ path: p, mime, ...r });
    process.stderr.write(` ${r.verdict.toUpperCase()} (${r.reason})\n`);
  } catch (e) {
    results.push({ path: p, mime, verdict: "error", error: e?.message });
    process.stderr.write(` ERROR: ${e?.message}\n`);
  }
}

// ── PDF generation ────────────────────────────────────────────────────────

process.stderr.write(`[3/3] writing ${outPdf}…\n`);

const PAGE_W = 612;   // Letter, points
const PAGE_H = 792;
const MARGIN = 48;

const pdf = new jsPDF({ unit: "pt", format: "letter" });
pdf.setProperties({
  title: "AI-Classification Report",
  subject: "Per-image AI vs human verdicts",
  creator: "DoNotTrain",
});

// ── Cover page
const aiCount = results.filter((r) => r.verdict === "ai").length;
const humanCount = results.filter((r) => r.verdict === "human").length;
const errCount = results.filter((r) => r.verdict === "error").length;

pdf.setFont("helvetica", "bold");
pdf.setFontSize(22);
pdf.setTextColor(20, 20, 20);
pdf.text("AI-Classification Report", MARGIN, 110);

pdf.setFont("helvetica", "normal");
pdf.setFontSize(10);
pdf.setTextColor(120, 120, 120);
pdf.text(`Source folder: ${inputDir}`, MARGIN, 130);
pdf.text(`Detector: C2PA Content Credentials + ${PIXEL_MODEL}`, MARGIN, 144);
pdf.text(`Threshold: ${AI_THRESHOLD * 100}% pixel-AI confidence`, MARGIN, 158);

// Summary block
pdf.setDrawColor(220, 220, 220);
pdf.setFillColor(247, 247, 248);
pdf.roundedRect(MARGIN, 200, PAGE_W - 2 * MARGIN, 100, 6, 6, "FD");

pdf.setFont("helvetica", "bold");
pdf.setFontSize(11);
pdf.setTextColor(80, 80, 80);
pdf.text("SUMMARY", MARGIN + 16, 222);

pdf.setFont("helvetica", "normal");
pdf.setFontSize(10);
pdf.setTextColor(40, 40, 40);
const sumX = MARGIN + 16;
pdf.text(`Total images:`, sumX, 248);   pdf.text(`${results.length}`, sumX + 120, 248);
pdf.text(`AI-flagged:`, sumX, 266);     pdf.setTextColor(180, 30, 30); pdf.text(`${aiCount}`, sumX + 120, 266);
pdf.setTextColor(40, 40, 40);
pdf.text(`Human:`, sumX, 284);          pdf.setTextColor(30, 130, 50);  pdf.text(`${humanCount}`, sumX + 120, 284);
if (errCount) { pdf.setTextColor(150, 90, 0); pdf.text(`Errors: ${errCount}`, sumX + 200, 248); }
pdf.setTextColor(40, 40, 40);

// Per-image index table
pdf.setFont("helvetica", "bold");
pdf.setFontSize(11);
pdf.setTextColor(80, 80, 80);
pdf.text("INDEX", MARGIN, 340);

pdf.setFont("helvetica", "normal");
pdf.setFontSize(9);
let cursorY = 360;
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  if (cursorY > PAGE_H - MARGIN) { pdf.addPage(); cursorY = MARGIN + 20; }
  pdf.setTextColor(120, 120, 120);
  pdf.text(`${i + 1}.`, MARGIN, cursorY);
  pdf.setTextColor(30, 30, 30);
  const fname = basename(r.path);
  pdf.text(fname.length > 70 ? fname.slice(0, 67) + "…" : fname, MARGIN + 20, cursorY);
  if (r.verdict === "ai") pdf.setTextColor(180, 30, 30);
  else if (r.verdict === "human") pdf.setTextColor(30, 130, 50);
  else pdf.setTextColor(150, 90, 0);
  pdf.text(r.verdict.toUpperCase(), PAGE_W - MARGIN - 50, cursorY);
  cursorY += 14;
}

// ── Per-image detail pages
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  pdf.addPage();

  // Header strip
  pdf.setFillColor(28, 28, 32);
  pdf.rect(0, 0, PAGE_W, 32, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(220, 220, 220);
  pdf.text(`Image ${i + 1} / ${results.length}`, MARGIN, 20);
  pdf.text("DoNotTrain · AI Classification", PAGE_W - MARGIN, 20, { align: "right" });

  // Image
  let imgBottomY = 60;
  if (r.verdict !== "error") {
    try {
      const bytes = await readFile(r.path);
      // jsPDF uses base64 for embedded images
      const b64 = bytes.toString("base64");
      const fmt = r.mime === "image/png" ? "PNG" : "JPEG";
      // Probe dimensions via sharp if available, else assume square 800px box
      let imgW = 800, imgH = 800;
      try {
        const sharp = (await import("sharp")).default;
        const meta = await sharp(bytes).metadata();
        imgW = meta.width || imgW;
        imgH = meta.height || imgH;
      } catch { /* sharp optional */ }

      const maxW = PAGE_W - 2 * MARGIN;
      const maxH = 380;
      const ratio = Math.min(maxW / imgW, maxH / imgH);
      const drawW = imgW * ratio;
      const drawH = imgH * ratio;
      const drawX = (PAGE_W - drawW) / 2;
      const drawY = 60;
      pdf.addImage(`data:${r.mime};base64,${b64}`, fmt, drawX, drawY, drawW, drawH);
      imgBottomY = drawY + drawH + 16;
    } catch (e) {
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(9);
      pdf.setTextColor(150, 30, 30);
      pdf.text(`(could not embed image: ${e?.message})`, MARGIN, 80);
      imgBottomY = 100;
    }
  }

  // Filename
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(20, 20, 20);
  const fname = basename(r.path);
  pdf.text(fname, MARGIN, imgBottomY);
  imgBottomY += 18;

  // Verdict badge — width auto-fits text so labels never bleed past the box
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  const badgeText =
    r.verdict === "ai" ? "AI · BLOCKED"
    : r.verdict === "human" ? "HUMAN · ALLOWED"
    : "ERROR";
  const badgePadX = 14;
  const badgeW = pdf.getTextWidth(badgeText) + badgePadX * 2;
  const badgeH = 24;
  if (r.verdict === "ai") {
    pdf.setFillColor(252, 232, 232);
    pdf.setDrawColor(180, 30, 30);
    pdf.setTextColor(180, 30, 30);
  } else if (r.verdict === "human") {
    pdf.setFillColor(232, 248, 234);
    pdf.setDrawColor(30, 130, 50);
    pdf.setTextColor(30, 130, 50);
  } else {
    pdf.setFillColor(255, 244, 220);
    pdf.setDrawColor(150, 90, 0);
    pdf.setTextColor(150, 90, 0);
  }
  pdf.roundedRect(MARGIN, imgBottomY - 4, badgeW, badgeH, 4, 4, "FD");
  pdf.text(badgeText, MARGIN + badgePadX, imgBottomY + 12);
  imgBottomY += badgeH + 14;

  // Detail rows
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(80, 80, 80);

  const labelX = MARGIN;
  const valueX = MARGIN + 140;
  let y = imgBottomY;
  const row = (label, value, color) => {
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(120, 120, 120);
    pdf.text(label, labelX, y);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...(color || [30, 30, 30]));
    const lines = pdf.splitTextToSize(String(value ?? "-"), PAGE_W - valueX - MARGIN);
    pdf.text(lines, valueX, y);
    y += 14 * Math.max(lines.length, 1);
  };

  if (r.verdict === "error") {
    row("Error", r.error || "(unknown)");
  } else {
    row("Pixel score",
      r.classifierScore != null
        ? `${(r.classifierScore * 100).toFixed(4)}% AI confidence (label: ${r.classifierLabel})`
        : "skipped (C2PA fired first)");
    row("C2PA manifest",
      r.c2pa.found
        ? (r.c2pa.isAI
            ? `Found, declares AI`
            : "Found, no AI claim")
        : "Not present");
    if (r.c2pa.generator) row("Claim generator", r.c2pa.generator);
    if (r.c2pa.digitalSourceType) row("Digital source", r.c2pa.digitalSourceType);
    if (r.reasonsText.length) {
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(120, 120, 120);
      pdf.text("Reasons", labelX, y);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(30, 30, 30);
      let yy = y;
      for (const reason of r.reasonsText) {
        const lines = pdf.splitTextToSize("• " + reason, PAGE_W - valueX - MARGIN);
        pdf.text(lines, valueX, yy);
        yy += 14 * lines.length;
      }
      y = yy;
    }
  }

  // Footer
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(170, 170, 170);
  pdf.text(`Page ${i + 2} / ${results.length + 1}`, PAGE_W / 2, PAGE_H - 24, { align: "center" });
}

const buf = pdf.output("arraybuffer");
await writeFile(outPdf, Buffer.from(buf));
process.stderr.write(`     done — ${outPdf}\n`);
console.log(JSON.stringify({
  total: results.length,
  ai: aiCount,
  human: humanCount,
  errors: errCount,
  output: outPdf,
}, null, 2));
