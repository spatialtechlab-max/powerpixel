// Combined per-image classification — runs BOTH guardrails:
//   1. AI-generation gate (C2PA Content Credentials + Organika/sdxl-detector
//      pixel classifier).  Same logic as scripts/batch-classify.mjs.
//   2. Brand-detection gate (Florence-2 vision-to-text locally + Perplexity
//      Sonar Pro for search-augmented brand verification). Same logic as
//      scripts/batch-brand-detect.mjs.
//
// Each image gets BOTH verdicts. Overall = BLOCKED if either guardrail
// blocks; ALLOWED only if both pass.
//
// Output: a single PDF with cover, summary, and one detail page per image
// showing the image, both verdicts, and all signal evidence.
//
// Run:
//   node scripts/batch-full-classify.mjs <input-dir> [output.pdf]

import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, basename, join, resolve } from "node:path";
import { jsPDF } from "jspdf";
import {
  pipeline,
  AutoProcessor,
  AutoTokenizer,
  Florence2ForConditionalGeneration,
  RawImage,
  env as txEnv,
} from "@huggingface/transformers";
import { Reader as C2paReader } from "@contentauth/c2pa-node";

// ── env loader ────────────────────────────────────────────────────────────
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

// ── shared transformers.js config ────────────────────────────────────────
txEnv.allowLocalModels = false;
txEnv.useBrowserCache = false;

// ── AI detection — C2PA + Organika pixel classifier ──────────────────────
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

function scanManifestStore(store) {
  const empty = { found: false, isAI: false, generator: null, digitalSourceType: null };
  if (!store?.manifests) return empty;
  const manifests = Object.values(store.manifests);
  if (manifests.length === 0) return empty;

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

  return {
    found: true,
    isAI: !!generatorMatch || !!digitalSource,
    generator: prettyGenerator,
    digitalSourceType: digitalSource,
  };
}

async function readC2pa(filePath, mime) {
  try {
    const bytes = await readFile(filePath);
    const reader = await C2paReader.fromAsset({ mimeType: mime, buffer: bytes });
    if (!reader) return { found: false, isAI: false, generator: null, digitalSourceType: null };
    return scanManifestStore(reader.json());
  } catch {
    return { found: false, isAI: false, generator: null, digitalSourceType: null };
  }
}

async function runPixel(classifier, filePath) {
  const out = await classifier(filePath);
  const aiHit = out.find((r) => /artificial|^ai$|generated|synthetic|fake|deepfake/i.test(r.label));
  if (aiHit) return { score: aiHit.score, label: aiHit.label };
  const top = [...out].sort((a, b) => b.score - a.score)[0];
  if (!top) return { score: 0, label: "unknown" };
  if (/human|real|natural|authentic|photo/i.test(top.label)) {
    return { score: 1 - top.score, label: `inverse(${top.label})` };
  }
  return { score: top.score, label: top.label };
}

async function detectAI(classifier, filePath, mime) {
  const c2pa = await readC2pa(filePath, mime);
  if (c2pa.isAI) {
    return {
      verdict: "ai", reason: "c2pa",
      classifierScore: null, classifierLabel: null,
      c2pa,
      reasons: [
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
      c2pa,
      reasons: [`Pixel classifier returned ${(pix.score * 100).toFixed(1)}% AI confidence (threshold ${AI_THRESHOLD * 100}%).`],
    };
  }
  return {
    verdict: "human", reason: "below-threshold",
    classifierScore: pix.score, classifierLabel: pix.label,
    c2pa,
    reasons: [],
  };
}

// ── Brand detection — Florence-2 + Sonar Pro ─────────────────────────────
const FLORENCE_MODEL = "onnx-community/Florence-2-base";
const SONAR_MODEL = "perplexity/sonar-pro";

const BRAND_PROMPT_SYSTEM = `You are a content-screening assistant for a copyright-registry system. The user is about to claim authorship of an image. You make TWO independent judgments based on a vision model's text description plus any OCR text it could read.

JUDGMENT 1 — AI generation:
The image classifier upstream is trained mostly on SDXL outputs and misses Midjourney, DALL·E/ChatGPT, Flux, Imagen, Firefly, Sora, and other generators. Your job is to catch what it misses by reasoning over the description. Common AI-generation tells in descriptions:
  - Hyperreal or "too-perfect" lighting, anatomy, symmetry
  - Stylized digital-painting language ("ethereal", "fantasy", "vibrant neon", "cinematic", "octane render", "concept art")
  - Anatomically impossible or extra fingers/limbs/teeth mentioned
  - Surreal compositions (floating objects, impossible reflections, melted geometry)
  - Subjects/styles strongly associated with diffusion/MJ outputs (anime girl with cyberpunk aesthetic, dramatic portrait with bokeh background, "cinematic" landscape, etc.)
  - Description reads like a generation prompt rather than a description of a real photo
Use web search to compare against known AI-generation patterns when you're unsure.

JUDGMENT 2 — Brand presence:
Block if any popular commercial brand, trademarked logo, mascot, or copyrighted character is a PRIMARY or FOCAL element of the image. Recreated trademarks (a hand-drawn Mickey, a fan-made Pokemon, a stylized Nike swoosh) ALSO trigger a block. Allow if no brand OR purely incidental presence (tiny logo in corner, half-visible billboard). Use web search to verify uncertain brand identifications.

Respond ONLY in this exact JSON format, with no markdown fences and no preamble:
{
  "ai_judgment": {
    "decision": "ai" | "human",
    "confidence": "high" | "medium" | "low",
    "tells": ["<short tells from the description that informed your decision>"],
    "reasoning": "<one or two sentences>"
  },
  "brand_judgment": {
    "brands_detected": [
      {
        "name": "<brand name>",
        "evidence": "<specific element from the description>",
        "confidence": "high" | "medium" | "low",
        "verified_via_search": true | false
      }
    ],
    "decision": "block" | "allow",
    "reasoning": "<one or two sentences>"
  }
}`;

async function callSonar({ caption, ocr }) {
  const userMsg = `Vision description:\n${caption || "(empty)"}\n\nOCR text from image:\n${ocr || "(none)"}`;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "HTTP-Referer": "https://donottrain.vercel.app",
      "X-Title": "DoNotTrain Brand Detection",
    },
    body: JSON.stringify({
      model: SONAR_MODEL,
      messages: [
        { role: "system", content: BRAND_PROMPT_SYSTEM },
        { role: "user", content: userMsg },
      ],
      temperature: 0,
      max_tokens: 600,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Sonar API error: ${res.status} ${JSON.stringify(json).slice(0, 400)}`);

  const content = json.choices?.[0]?.message?.content ?? "";
  const citations = json.citations ?? json.choices?.[0]?.message?.citations ?? [];
  const stripped = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  let parsed;
  try { parsed = JSON.parse(stripped); }
  catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = null; } }
  }

  // Defensive fallback: if Sonar didn't return JSON or returned the old
  // single-judgment shape, normalize to the dual-judgment shape so the rest
  // of the pipeline can keep going.
  const safe = parsed && typeof parsed === "object" ? parsed : {};
  const aiJ = safe.ai_judgment ?? { decision: "human", confidence: "low", tells: [], reasoning: "(no ai_judgment returned)" };
  const brJ = safe.brand_judgment ?? safe ?? { brands_detected: [], decision: "allow", reasoning: "(no brand_judgment returned)" };
  return { ai: aiJ, brand: brJ, citations };
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
  console.error("usage: node scripts/batch-full-classify.mjs <input-dir> [output.pdf]");
  process.exit(2);
}
const inputDir = resolve(args[0]);
const outPdf = resolve(args[1] || "Classification-Report.pdf");

process.stderr.write(`[1/5] loading ${PIXEL_MODEL}…\n`);
const pixelClassifier = await pipeline("image-classification", PIXEL_MODEL);

process.stderr.write(`[2/5] loading ${FLORENCE_MODEL} (uint8 quantized)…\n`);
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

process.stderr.write(`[3/5] scanning ${inputDir}…\n`);
const entries = (await readdir(inputDir, { withFileTypes: true }))
  .filter((d) => d.isFile())
  .map((d) => join(inputDir, d.name))
  .filter((p) => mimeFromExt(p))
  .sort();
process.stderr.write(`     ${entries.length} images found\n`);

process.stderr.write(`[4/5] running both gates per image…\n`);
const results = [];
for (let i = 0; i < entries.length; i++) {
  const p = entries[i];
  const mime = mimeFromExt(p);
  process.stderr.write(`     [${i + 1}/${entries.length}] ${basename(p)}\n`);
  try {
    process.stderr.write(`         · ai gate (c2pa + pixel)…`);
    const ai = await detectAI(pixelClassifier, p, mime);
    process.stderr.write(` ${ai.verdict.toUpperCase()} (${ai.reason})\n`);

    process.stderr.write(`         · florence: caption + ocr…`);
    const florenceOut = await describeImage(p);
    process.stderr.write(` ok (${florenceOut.caption.length} cap / ${florenceOut.ocr.length} ocr)\n`);

    process.stderr.write(`         · sonar: ai + brand check…`);
    const sonar = await callSonar(florenceOut);
    process.stderr.write(` ai=${sonar.ai.decision?.toUpperCase()}/brand=${sonar.brand.decision?.toUpperCase()} (${sonar.brand.brands_detected?.length ?? 0} brand(s))\n`);

    // AI gate fires if EITHER the local pixel/C2PA check OR Sonar's
    // description-based judgment flags it.
    const aiBlocked = ai.verdict === "ai" || sonar.ai.decision === "ai";
    const brandBlocked = sonar.brand.decision === "block";
    const overall = (aiBlocked || brandBlocked) ? "block" : "allow";

    results.push({
      path: p, mime,
      ai,                            // local pixel + C2PA result
      sonarAi: sonar.ai,             // sonar's description-based AI judgment
      florence: florenceOut,
      brand: sonar.brand,
      brandCitations: sonar.citations,
      aiBlocked, brandBlocked, overall,
    });
  } catch (e) {
    process.stderr.write(`         · ERROR: ${e?.message}\n`);
    results.push({ path: p, mime, error: e?.message });
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────
process.stderr.write(`[5/5] writing ${outPdf}…\n`);

const PAGE_W = 612, PAGE_H = 792, MARGIN = 48;

const pdf = new jsPDF({ unit: "pt", format: "letter" });
pdf.setProperties({
  title: "DoNotTrain Classification Report",
  subject: "Per-image AI + Brand verdicts",
  creator: "DoNotTrain",
});

// Cover
const blocked = results.filter((r) => r.overall === "block").length;
const allowed = results.filter((r) => r.overall === "allow").length;
const errors = results.filter((r) => r.error).length;

pdf.setFont("helvetica", "bold");
pdf.setFontSize(22);
pdf.setTextColor(20, 20, 20);
pdf.text("DoNotTrain Classification Report", MARGIN, 110);

pdf.setFont("helvetica", "normal");
pdf.setFontSize(10);
pdf.setTextColor(120, 120, 120);
pdf.text(`Source folder: ${inputDir}`, MARGIN, 130);
pdf.text(`AI gate:    C2PA Content Credentials + ${PIXEL_MODEL} (threshold ${AI_THRESHOLD * 100}%)`, MARGIN, 144);
pdf.text(`Brand gate: ${FLORENCE_MODEL} (local) + openrouter/${SONAR_MODEL} (search-augmented, text-only)`, MARGIN, 158);
pdf.text(`Privacy: image bytes never sent to remote APIs; only local-model text outputs are.`, MARGIN, 172);

// Summary
pdf.setDrawColor(220, 220, 220);
pdf.setFillColor(247, 247, 248);
pdf.roundedRect(MARGIN, 200, PAGE_W - 2 * MARGIN, 110, 6, 6, "FD");

pdf.setFont("helvetica", "bold");
pdf.setFontSize(11);
pdf.setTextColor(80, 80, 80);
pdf.text("OVERALL", MARGIN + 16, 222);

pdf.setFont("helvetica", "normal");
pdf.setFontSize(10);
pdf.setTextColor(40, 40, 40);
const sx = MARGIN + 16;
pdf.text(`Total:`, sx, 248);   pdf.text(`${results.length}`, sx + 120, 248);
pdf.text(`Blocked:`, sx, 266); pdf.setTextColor(180, 30, 30); pdf.text(`${blocked}`, sx + 120, 266);
pdf.setTextColor(40, 40, 40);
pdf.text(`Allowed:`, sx, 284); pdf.setTextColor(30, 130, 50); pdf.text(`${allowed}`, sx + 120, 284);
if (errors) { pdf.setTextColor(150, 90, 0); pdf.text(`Errors: ${errors}`, sx + 200, 248); }
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
  pdf.text("DoNotTrain · AI + Brand Classification", PAGE_W - MARGIN, 20, { align: "right" });

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
      const maxH = 240;
      const ratio = Math.min(maxW / imgW, maxH / imgH);
      const drawW = imgW * ratio, drawH = imgH * ratio;
      const drawX = (PAGE_W - drawW) / 2;
      pdf.addImage(`data:${r.mime};base64,${b64}`, fmt, drawX, y, drawW, drawH);
      y += drawH + 16;
    } catch (e) {
      pdf.setTextColor(150, 30, 30);
      pdf.text(`(could not embed: ${e?.message})`, MARGIN, y);
      y += 24;
    }
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(20, 20, 20);
  pdf.text(basename(r.path), MARGIN, y);
  y += 18;

  // Two badges side by side: AI verdict + Brand verdict
  const drawBadge = (text, x, fill, draw, fg) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    const padX = 12;
    const w = pdf.getTextWidth(text) + padX * 2;
    const h = 22;
    pdf.setFillColor(...fill);
    pdf.setDrawColor(...draw);
    pdf.setTextColor(...fg);
    pdf.roundedRect(x, y - 3, w, h, 4, 4, "FD");
    pdf.text(text, x + padX, y + 11);
    return w;
  };

  if (r.error) {
    drawBadge("ERROR", MARGIN, [255, 244, 220], [150, 90, 0], [150, 90, 0]);
    y += 30;
  } else {
    const aiBadge = r.aiBlocked
      ? { text: "AI · BLOCKED", fill: [252, 232, 232], draw: [180, 30, 30], fg: [180, 30, 30] }
      : { text: "HUMAN · OK",   fill: [232, 248, 234], draw: [30, 130, 50], fg: [30, 130, 50] };
    const brandBadge = r.brandBlocked
      ? { text: "BRAND · BLOCKED", fill: [252, 232, 232], draw: [180, 30, 30], fg: [180, 30, 30] }
      : { text: "NO BRAND · OK",   fill: [232, 248, 234], draw: [30, 130, 50], fg: [30, 130, 50] };
    const overallBadge = r.overall === "block"
      ? { text: "OVERALL · BLOCKED", fill: [180, 30, 30], draw: [180, 30, 30], fg: [255, 255, 255] }
      : { text: "OVERALL · ALLOWED", fill: [30, 130, 50], draw: [30, 130, 50], fg: [255, 255, 255] };

    let bx = MARGIN;
    bx += drawBadge(aiBadge.text, bx, aiBadge.fill, aiBadge.draw, aiBadge.fg) + 8;
    bx += drawBadge(brandBadge.text, bx, brandBadge.fill, brandBadge.draw, brandBadge.fg) + 8;
    drawBadge(overallBadge.text, bx, overallBadge.fill, overallBadge.draw, overallBadge.fg);
    y += 32;
  }

  // Detail rows
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(80, 80, 80);

  const labelX = MARGIN, valueX = MARGIN + 110;
  const row = (label, value, color) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.text(label, labelX, y);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...(color || [30, 30, 30]));
    const lines = pdf.splitTextToSize(String(value ?? "-"), PAGE_W - valueX - MARGIN);
    pdf.text(lines, valueX, y);
    y += 11 * Math.max(lines.length, 1);
  };

  if (r.error) {
    row("Error", r.error);
  } else {
    // AI gate section
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text("AI GATE", labelX, y);
    y += 14;

    row("Pixel score",
      r.ai.classifierScore != null
        ? `${(r.ai.classifierScore * 100).toFixed(4)}% AI confidence (${r.ai.classifierLabel})`
        : "skipped (C2PA fired first)");
    row("C2PA",
      r.ai.c2pa.found
        ? (r.ai.c2pa.isAI ? `Found, declares AI` : "Found, no AI claim")
        : "Not present");
    if (r.ai.c2pa.generator) row("  generator", r.ai.c2pa.generator);
    if (r.ai.c2pa.digitalSourceType) row("  digital src", r.ai.c2pa.digitalSourceType);

    // Sonar's description-based AI judgment (covers MJ / DALL-E / Flux / etc.
    // that the SDXL-trained pixel model misses)
    const sj = r.sonarAi || {};
    row("Sonar AI judge",
      `${(sj.decision ?? "?").toUpperCase()} (${sj.confidence ?? "?"})${sj.reasoning ? " — " + sj.reasoning : ""}`,
      sj.decision === "ai" ? [180, 30, 30] : [30, 30, 30]);
    if (Array.isArray(sj.tells) && sj.tells.length > 0) {
      row("  tells", sj.tells.join("; "));
    }

    y += 6;

    // Brand gate section
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text("BRAND GATE", labelX, y);
    y += 14;

    row("Caption", r.florence.caption || "(empty)");
    if (r.florence.ocr && r.florence.ocr.length > 1) row("OCR", r.florence.ocr);
    row("Reasoning", r.brand?.reasoning || "-");
    if ((r.brand?.brands_detected?.length ?? 0) > 0) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(120, 120, 120);
      pdf.text("Brands", labelX, y);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.5);
      pdf.setTextColor(30, 30, 30);
      let yy = y;
      for (const b of r.brand.brands_detected) {
        const txt = `• ${b.name} — ${b.evidence ?? ""} [confidence: ${b.confidence ?? "?"}, search-verified: ${b.verified_via_search ? "yes" : "no"}]`;
        const lines = pdf.splitTextToSize(txt, PAGE_W - valueX - MARGIN);
        pdf.text(lines, valueX, yy);
        yy += 11 * lines.length;
      }
      y = yy + 4;
    }
    if (Array.isArray(r.brandCitations) && r.brandCitations.length > 0) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(120, 120, 120);
      pdf.text("Sources", labelX, y);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(40, 90, 200);
      let yy = y;
      for (const c of r.brandCitations.slice(0, 4)) {
        const url = typeof c === "string" ? c : (c?.url ?? "");
        if (!url) continue;
        const lines = pdf.splitTextToSize(`• ${url}`, PAGE_W - valueX - MARGIN);
        pdf.text(lines, valueX, yy);
        yy += 11 * lines.length;
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
  blocked,
  allowed,
  errors,
  output: outPdf,
}, null, 2));
