// Batch brand-detection over a folder of images.
//
// Architecture (privacy-preserving):
//   1. Florence-2-base runs LOCALLY in Node (same model + ONNX shards the
//      browser will use). For each image we pull two text outputs:
//        - <MORE_DETAILED_CAPTION>: a paragraph describing what's in the
//          image, including logos, packaging, mascots, products.
//        - <OCR>: every visible text string in the image.
//   2. Only that text — no pixels — is sent to OpenRouter
//      `perplexity/sonar-pro`, which has native web search. Sonar verifies
//      brand candidates against the live web and returns a structured
//      block/allow verdict plus citations.
//   3. We assemble a per-image PDF report (image embedded, Florence-2
//      outputs, brands found, citations, decision).
//
// Run:
//   node scripts/batch-brand-detect.mjs <input-dir> [output.pdf]

import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, basename, join, resolve } from "node:path";
import { jsPDF } from "jspdf";
import {
  AutoProcessor,
  AutoTokenizer,
  Florence2ForConditionalGeneration,
  RawImage,
  env,
} from "@huggingface/transformers";

// ── env loader (reads .env.local without pulling in dotenv) ────────────────
async function loadEnvLocal() {
  try {
    const txt = await readFile(".env.local", "utf-8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
await loadEnvLocal();

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_KEY) {
  console.error("OPENROUTER_API_KEY not set in .env.local");
  process.exit(1);
}

// ── Florence-2 setup ──────────────────────────────────────────────────────
const FLORENCE_MODEL = "onnx-community/Florence-2-base";
env.allowLocalModels = false;
env.useBrowserCache = false;

process.stderr.write(`[1/4] loading ${FLORENCE_MODEL} (uint8 quantized, ~260 MB total shards)…\n`);
// In Node, onnxruntime-node lacks several fp16 + q4 fused ops Florence-2's
// vision encoder uses. uint8 ("quantized") is the cross-runtime safe choice
// — same shards the browser will use as a fallback when WebGPU isn't there.
const florence = await Florence2ForConditionalGeneration.from_pretrained(FLORENCE_MODEL, {
  dtype: {
    embed_tokens: "quantized",
    vision_encoder: "quantized",
    encoder_model: "quantized",
    decoder_model_merged: "quantized",
  },
  device: "cpu",
});
const florenceProcessor = await AutoProcessor.from_pretrained(FLORENCE_MODEL);
const florenceTokenizer = await AutoTokenizer.from_pretrained(FLORENCE_MODEL);

async function florenceTask(imagePath, taskPrompt) {
  const image = await RawImage.read(imagePath);
  const visionInputs = await florenceProcessor(image);
  const prompts = florenceProcessor.construct_prompts(taskPrompt);
  const textInputs = florenceTokenizer(prompts);

  const generated = await florence.generate({
    ...textInputs,
    ...visionInputs,
    max_new_tokens: 256,
    num_beams: 3,
    do_sample: false,
  });

  const decoded = florenceTokenizer.batch_decode(generated, { skip_special_tokens: false })[0];
  const result = florenceProcessor.post_process_generation(decoded, taskPrompt, image.size);
  return result?.[taskPrompt] ?? "";
}

async function describeImage(imagePath) {
  const caption = await florenceTask(imagePath, "<MORE_DETAILED_CAPTION>");
  const ocr = await florenceTask(imagePath, "<OCR>");
  return { caption: String(caption).trim(), ocr: String(ocr).trim() };
}

// ── OpenRouter / Perplexity Sonar Pro ────────────────────────────────────
const SONAR_MODEL = "perplexity/sonar-pro";

const BRAND_PROMPT_SYSTEM = `You are a brand-detection assistant for a copyright-registry system. The user is about to claim authorship of an image. We block the registration if the image contains popular commercial brands, trademarked logos, mascots, or copyrighted product designs as a primary or focal element.

You will receive:
  - A vision model's text description of the image
  - Any text the vision model could read inside the image (OCR)

Use web search to verify any uncertain brand identifications.

Respond ONLY in this exact JSON format, with no markdown fences and no preamble:
{
  "brands_detected": [
    {
      "name": "<brand name>",
      "evidence": "<specific element from the description that points to this brand>",
      "confidence": "high" | "medium" | "low",
      "verified_via_search": true | false
    }
  ],
  "decision": "block" | "allow",
  "reasoning": "<one or two sentences explaining the decision>"
}

Decision rules:
  - "block" if any popular commercial brand, trademarked logo, mascot, or copyrighted character is a primary, focal, or dominant element of the image. Recreated trademarks (e.g., a hand-drawn Mickey Mouse, a fan-made Pokemon, a stylized Nike swoosh) ALSO trigger block.
  - "allow" if no brand presence is identified, OR if brand presence is purely incidental (e.g., a tiny laptop logo in the corner of a portrait, a half-visible billboard in a cityscape).
  - When in doubt about whether something is a popular brand, search the web before deciding.`;

async function callSonar({ caption, ocr }) {
  const userMsg = `Vision description:\n${caption || "(empty)"}\n\nOCR text from image:\n${ocr || "(none)"}`;

  const body = {
    model: SONAR_MODEL,
    messages: [
      { role: "system", content: BRAND_PROMPT_SYSTEM },
      { role: "user", content: userMsg },
    ],
    temperature: 0,
    max_tokens: 600,
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "HTTP-Referer": "https://donottrain.vercel.app",
      "X-Title": "DoNotTrain Brand Detection",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Sonar API error: ${res.status} ${JSON.stringify(json).slice(0, 400)}`);
  }

  const content = json.choices?.[0]?.message?.content ?? "";
  const citations = json.citations ?? json.choices?.[0]?.message?.citations ?? [];

  // Sonar sometimes wraps JSON in ```json fences; strip them defensively.
  const stripped = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    // Fallback: extract first {...} block
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { parsed = null; }
    }
  }

  return {
    parsed: parsed ?? { brands_detected: [], decision: "allow", reasoning: "(Sonar returned non-JSON; treating as allow)" },
    raw: content,
    citations,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────
function mimeFromExt(p) {
  const e = extname(p).slice(1).toLowerCase();
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  return null;
}

// ── driver ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("usage: node scripts/batch-brand-detect.mjs <input-dir> [output.pdf]");
  process.exit(2);
}
const inputDir = resolve(args[0]);
const outPdf = resolve(args[1] || "Brand-Detection-Report.pdf");

process.stderr.write(`[2/4] scanning ${inputDir}…\n`);
const entries = (await readdir(inputDir, { withFileTypes: true }))
  .filter((d) => d.isFile())
  .map((d) => join(inputDir, d.name))
  .filter((p) => mimeFromExt(p))
  .sort();
process.stderr.write(`     ${entries.length} images found\n`);

const results = [];
for (let i = 0; i < entries.length; i++) {
  const p = entries[i];
  process.stderr.write(`     [${i + 1}/${entries.length}] ${basename(p)}\n`);
  try {
    process.stderr.write(`         · florence: caption + ocr…`);
    const florenceOut = await describeImage(p);
    process.stderr.write(` ok (${florenceOut.caption.length} chars caption, ${florenceOut.ocr.length} chars ocr)\n`);

    process.stderr.write(`         · sonar: brand check via web search…`);
    const sonar = await callSonar(florenceOut);
    process.stderr.write(` ${sonar.parsed.decision?.toUpperCase()} (${sonar.parsed.brands_detected?.length ?? 0} brand(s))\n`);

    results.push({
      path: p,
      mime: mimeFromExt(p),
      florence: florenceOut,
      sonar: sonar.parsed,
      sonarRaw: sonar.raw,
      citations: sonar.citations,
    });
  } catch (e) {
    process.stderr.write(`         · ERROR: ${e?.message}\n`);
    results.push({ path: p, mime: mimeFromExt(p), error: e?.message });
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────
process.stderr.write(`[4/4] writing ${outPdf}…\n`);

const PAGE_W = 612, PAGE_H = 792, MARGIN = 48;

const pdf = new jsPDF({ unit: "pt", format: "letter" });
pdf.setProperties({
  title: "Brand Detection Report",
  subject: "Per-image brand detection via local Florence-2 + Perplexity Sonar",
  creator: "DoNotTrain",
});

// Cover
const blockCount = results.filter((r) => r.sonar?.decision === "block").length;
const allowCount = results.filter((r) => r.sonar?.decision === "allow").length;
const errCount = results.filter((r) => r.error).length;

pdf.setFont("helvetica", "bold");
pdf.setFontSize(22);
pdf.setTextColor(20, 20, 20);
pdf.text("Brand Detection Report", MARGIN, 110);

pdf.setFont("helvetica", "normal");
pdf.setFontSize(10);
pdf.setTextColor(120, 120, 120);
pdf.text(`Source folder: ${inputDir}`, MARGIN, 130);
pdf.text(`Local vision: ${FLORENCE_MODEL}`, MARGIN, 144);
pdf.text(`Search-augmented LLM: openrouter / ${SONAR_MODEL}`, MARGIN, 158);
pdf.text(`Privacy: image bytes never left the browser; only the Florence-2 text description was sent to Sonar.`, MARGIN, 172);

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
const sx = MARGIN + 16;
pdf.text(`Total:`, sx, 248);   pdf.text(`${results.length}`, sx + 120, 248);
pdf.text(`Blocked:`, sx, 266); pdf.setTextColor(180, 30, 30); pdf.text(`${blockCount}`, sx + 120, 266);
pdf.setTextColor(40, 40, 40);
pdf.text(`Allowed:`, sx, 284); pdf.setTextColor(30, 130, 50); pdf.text(`${allowCount}`, sx + 120, 284);
if (errCount) { pdf.setTextColor(150, 90, 0); pdf.text(`Errors: ${errCount}`, sx + 200, 248); }
pdf.setTextColor(40, 40, 40);

// Per-image
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  pdf.addPage();

  pdf.setFillColor(28, 28, 32);
  pdf.rect(0, 0, PAGE_W, 32, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(220, 220, 220);
  pdf.text(`Image ${i + 1} / ${results.length}`, MARGIN, 20);
  pdf.text("DoNotTrain · Brand Detection", PAGE_W - MARGIN, 20, { align: "right" });

  let y = 60;
  if (!r.error) {
    try {
      const bytes = await readFile(r.path);
      const b64 = bytes.toString("base64");
      const fmt = r.mime === "image/png" ? "PNG" : r.mime === "image/webp" ? "WEBP" : "JPEG";
      let imgW = 800, imgH = 800;
      try {
        const sharp = (await import("sharp")).default;
        const meta = await sharp(bytes).metadata();
        imgW = meta.width || imgW;
        imgH = meta.height || imgH;
      } catch {}
      const maxW = PAGE_W - 2 * MARGIN;
      const maxH = 280;
      const ratio = Math.min(maxW / imgW, maxH / imgH);
      const drawW = imgW * ratio, drawH = imgH * ratio;
      const drawX = (PAGE_W - drawW) / 2;
      pdf.addImage(`data:${r.mime};base64,${b64}`, fmt, drawX, y, drawW, drawH);
      y += drawH + 16;
    } catch (e) {
      pdf.setTextColor(150, 30, 30);
      pdf.text(`(could not embed image: ${e?.message})`, MARGIN, y);
      y += 24;
    }
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(20, 20, 20);
  pdf.text(basename(r.path), MARGIN, y);
  y += 18;

  // Verdict badge
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  const badgeText = r.error
    ? "ERROR"
    : r.sonar?.decision === "block"
      ? "BRAND DETECTED · BLOCKED"
      : "NO BRAND · ALLOWED";
  const badgePadX = 14;
  const badgeW = pdf.getTextWidth(badgeText) + badgePadX * 2;
  const badgeH = 24;
  if (r.error) { pdf.setFillColor(255, 244, 220); pdf.setDrawColor(150, 90, 0); pdf.setTextColor(150, 90, 0); }
  else if (r.sonar?.decision === "block") { pdf.setFillColor(252, 232, 232); pdf.setDrawColor(180, 30, 30); pdf.setTextColor(180, 30, 30); }
  else { pdf.setFillColor(232, 248, 234); pdf.setDrawColor(30, 130, 50); pdf.setTextColor(30, 130, 50); }
  pdf.roundedRect(MARGIN, y - 4, badgeW, badgeH, 4, 4, "FD");
  pdf.text(badgeText, MARGIN + badgePadX, y + 12);
  y += badgeH + 14;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(80, 80, 80);

  const labelX = MARGIN, valueX = MARGIN + 130;
  const row = (label, value, color) => {
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(120, 120, 120);
    pdf.text(label, labelX, y);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...(color || [30, 30, 30]));
    const lines = pdf.splitTextToSize(String(value ?? "-"), PAGE_W - valueX - MARGIN);
    pdf.text(lines, valueX, y);
    y += 12 * Math.max(lines.length, 1);
  };

  if (r.error) {
    row("Error", r.error);
  } else {
    row("Caption", r.florence.caption || "(empty)");
    if (r.florence.ocr) row("OCR text", r.florence.ocr);
    row("Reasoning", r.sonar?.reasoning || "-");
    if ((r.sonar?.brands_detected?.length ?? 0) > 0) {
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(120, 120, 120);
      pdf.text("Brands", labelX, y);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(30, 30, 30);
      let yy = y;
      for (const b of r.sonar.brands_detected) {
        const txt = `• ${b.name} — ${b.evidence ?? ""} [confidence: ${b.confidence ?? "?"}, search-verified: ${b.verified_via_search ? "yes" : "no"}]`;
        const lines = pdf.splitTextToSize(txt, PAGE_W - valueX - MARGIN);
        pdf.text(lines, valueX, yy);
        yy += 12 * lines.length;
      }
      y = yy + 4;
    }
    if (Array.isArray(r.citations) && r.citations.length > 0) {
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(120, 120, 120);
      pdf.text("Sources", labelX, y);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(40, 90, 200);
      let yy = y;
      for (const c of r.citations.slice(0, 5)) {
        const url = typeof c === "string" ? c : (c?.url ?? "");
        if (!url) continue;
        const lines = pdf.splitTextToSize(`• ${url}`, PAGE_W - valueX - MARGIN);
        pdf.text(lines, valueX, yy);
        yy += 12 * lines.length;
      }
      y = yy;
    }
  }

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
  blocked: blockCount,
  allowed: allowCount,
  errors: errCount,
  output: outPdf,
}, null, 2));
