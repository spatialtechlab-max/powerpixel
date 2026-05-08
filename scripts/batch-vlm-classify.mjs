// Strong-detection per-image classification — accuracy first, privacy
// is no longer a constraint at the user's request.
//
// Four-signal stack per image:
//   1. C2PA Content Credentials (instant, signed metadata)
//   2. Organika/sdxl-detector  (local pixel classifier, fast pre-check)
//   3. Perplexity Sonar Pro Vision  (sees the image, native web search)
//   4. Anthropic Claude Sonnet 4.6 Vision + `:online`  (frontier reasoning,
//      Exa-powered web search)
//
// Each vision LLM returns THREE judgments per image:
//   - ai_judgment      (informational — does NOT block on its own)
//   - brand_judgment   (BLOCKS if a popular commercial brand is focal)
//   - watermark_judgment (BLOCKS if a third-party stamp is present:
//                        stock-preview tiles, AI-generator watermarks,
//                        "PROOF"/"SAMPLE"/etc. overlays)
//
// Overall: BLOCK if brand OR watermark fires (per either vision LLM).
//          AI alone does not block — the user reviews AI status as info.
//
// Run:
//   node scripts/batch-vlm-classify.mjs <input-dir> [output.pdf]

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
if (!OPENROUTER_KEY) { console.error("OPENROUTER_API_KEY not set in .env.local"); process.exit(1); }

txEnv.allowLocalModels = false;
txEnv.useBrowserCache = false;

// ── AI / C2PA / Organika ─────────────────────────────────────────────────
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
    active?.claim_generator || active?.claim_generator_info?.[0]?.name ||
    manifests[0]?.claim_generator || manifests[0]?.claim_generator_info?.[0]?.name || null;
  let generatorMatch = null, digitalSource = null;
  for (const m of manifests) {
    const blob = [m.claim_generator ?? "", ...(m.claim_generator_info ?? []).map((g) => g?.name ?? "")].join(" ").toLowerCase();
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
    const reader = await C2paReader.fromAsset({ mimeType: mime, buffer: bytes });
    if (!reader) return { found: false, isAI: false, generator: null, digitalSourceType: null };
    return scanManifestStore(reader.json());
  } catch { return { found: false, isAI: false, generator: null, digitalSourceType: null }; }
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

// ── Vision LLM ensemble via OpenRouter ───────────────────────────────────

const PROMPT = `You are a content-screening system for a copyright registry. Make THREE independent judgments about the attached image.

JUDGMENT 1 — AI generation (informational only, used by reviewers to understand provenance; does NOT itself decide allow/block):
Decide whether the image was generated by an AI model (Midjourney, DALL·E / ChatGPT-image, Stable Diffusion family including SDXL, Flux, Imagen, Adobe Firefly, Sora-image, Leonardo, Ideogram, etc.) versus produced by a human (photograph, painting, hand-drawing, vector art, photo composite, screenshot of a real interface).
Visual tells: anatomical errors (extra/missing fingers, malformed teeth, weird ears), hyperreal lighting, "painted" textures on hair/fur/fabric, background details that decay on close inspection, symmetric or unnaturally clean compositions, telltale MJ v6 / DALL·E 3 / SDXL / Flux style fingerprints. Use web search if uncertain. Be aggressive: lean "ai" when the image is moderately AI-styled.

JUDGMENT 2 — Brand presence (BLOCKING):

**HARD RULE — apply mechanically, no judgment calls:** scan the image and list every recognizable commercial brand or trademarked logo in the brands_detected array. **If your list has 3 or more entries, decision = "block". End of rule.** This is not a judgment about whether brands are "focal" or "incidental" — it is a count. A photograph of Times Square, Shibuya crossing, Piccadilly Circus, a sports stadium with sponsor walls, a supermarket aisle, a shopping mall storefront row, or a person carrying multiple brand-named shopping bags will obviously hit this rule. Block them.

ALSO BLOCK (regardless of count) if:
  - A single popular brand / trademarked logo / mascot / copyrighted character is the focal subject of the image
  - The work is a recreated/derivative trademark (stylized Nike swoosh, fan-art Pikachu, hand-drawn Mickey, Super-Saiyan-style character)

ENUMERATION INSTRUCTIONS — be exhaustive:
Walk through the frame quadrant by quadrant. Read every sign, neon, storefront, shop awning, illuminated logo, product label, shopping bag, clothing brand on hoodies/caps/shoes, TV ad, billboard, car logo, taxi sign. Examples that count: UNIQLO, McDonald's, Coca-Cola, Pepsi, Sony, Toyota, Honda, BMW, Tesla, Netflix, Disney, Apple, Samsung, Starbucks, 7-Eleven, FamilyMart, Lawson, GUCCI, Louis Vuitton, Nike, Adidas, Supreme, Canon, Nikon, Asahi, Kirin, Sapporo, SEGA, Panasonic, Yamaha, Pokemon, Mickey Mouse, KFC, etc. — list ANY commercial brand. If you see a sign you can't read but it appears commercial, list it as "unknown commercial sign". Use web search for uncertain logos.

ALLOW only if your brands_detected list is empty (or has 1–2 entries AND each is clearly incidental AND not the subject), OR the image IS itself a logo/design the registrant created.

JUDGMENT 3 — Watermark / third-party overlay presence (BLOCKING):

**MANDATORY PRE-CHECK BEFORE ANYTHING ELSE:** First classify the image's medium:
  - Is it a **painterly artwork** (oil-painting, illustration, fantasy art, tarot card, gothic painting, digital painting with thick brushwork, Klimt-style, Pre-Raphaelite, ukiyo-e style, etc.)?
  - Is it a **real photograph** (a city street, a portrait, a landscape, a product photo)?
  - Is it a **photo-realistic AI output** (typical Gemini/MJ/SDXL output that LOOKS like a photo)?
  - Is it **stock photo content** (a clean studio image, a model on a white background, a polished lifestyle shot)?

If the medium is "painterly artwork": **any suns, moons, stars, sunbursts, mandalas, halos, glowing orbs, or radial light effects in the image are part of the artwork — return decision: "allow" — DO NOT FLAG THESE AS WATERMARKS.** The Gemini watermark only appears on photo-realistic Gemini interface outputs and is a sharp digital metallic four-pointed sparkle. It is NEVER a brush-painted celestial element. A painted sun in a Klimt-like or fantasy painting is just a sun.

THEN, only if the medium is "photo-realistic AI output", scan corners for AI generator watermarks. If "real photograph", scan for stock-agency watermarks. If "stock content", expect tiled preview overlays.

CRITICAL: SCAN ALL FOUR CORNERS OF THE IMAGE PIXEL BY PIXEL. AI generator watermarks are typically tiny (10–60 pixels) and placed in a corner — usually bottom-right. They are easy to dismiss as decorative elements. DO NOT dismiss them.

Specific AI generator watermarks to recognize:
  - **Google Gemini / Imagen**: a small four-pointed iridescent sparkle/star, like the symbol ✦ or ✧, in the bottom-right corner. The points are unequal length (longer vertical than horizontal), with a blue/purple/teal gradient. Easily mistaken for a "decorative star" inside a fantasy/space image — IT IS NOT, it is the Gemini AI watermark.
  - **DALL·E 3 / OpenAI ChatGPT**: a horizontal row of 5 small colored squares (red, orange, yellow, green, blue) — a rainbow stripe — in the bottom-right corner.
  - **Adobe Firefly**: small "Adobe Firefly" text or the stylized Firefly icon, usually bottom-right.
  - **Microsoft Bing Image Creator / Designer**: small Microsoft "Designer" badge or Bing logo in a corner.
  - **OpenAI Sora**: small "Sora" text mark or OpenAI logo.
  - **Stable Diffusion / SDXL**: usually no watermark, but custom UIs may add one.

Other watermark types — also block:
  - Tiled or repeating watermark pattern across the image: PROOF, SAMPLE, PREVIEW, COPY, WATERMARK, DEMO, COMP, "Not for Distribution", "Do Not Use"
  - Stock agency watermark anywhere on the image: Shutterstock, Getty Images, iStock, Adobe Stock, Alamy, Dreamstime, 123RF, Depositphotos, Stocksy, EyeEm, Bigstock, AP, Reuters, NurPhoto, ZUMA Press, Envato, etc.
  - Translucent diagonal text repeated multiple times

DO NOT FLAG AS WATERMARKS — these are NEVER watermarks (return decision: "allow" if these are the only thing you see):
  - **Painterly artworks with celestial elements** — when the image is an oil-painting / illustration / fantasy art / tarot card / gothic painting / digital painting style, ANY suns, moons, stars, sunbursts, mandalas, halos, glowing orbs, or radial light effects rendered in painterly brushwork ARE PART OF THE ARTWORK. The Gemini watermark only appears on outputs from the Google Gemini interface and looks like a sharp metallic four-pointed sparkle that is clearly digital and pasted on. A painted sun rendered with brushwork and the same texture as the rest of an oil painting is NEVER a watermark — even if it happens to be roughly star-shaped.
  - **Letterbox bars / screenshot framing** — black bars above/below an image, a thin gray UI strip with browser or app chrome at the very top, page-edge artifacts. These are screenshot capture context, not third-party watermarks applied to the image.
  - **Sign elements in a real photographed scene** — store signs, posters, advertising boards, neon icons inside a real photo of a city street, store interior, or stadium. Those are content of the scene (handled by the brand gate), not watermarks.
  - **Subtle artist signature** — a small "© Name 2024" or initials in one corner. Allowed.
  - **Logos that ARE the work** — the registrant created a logo design; the mark is the subject, not an overlay.

DECISION RULE — apply STRICTLY: a watermark must satisfy ALL of the following:
  (1) It is **visually distinct in rendering technique** from the underlying image (sharp digital edges, vector-like quality, smooth gradients, different color palette — clearly looks "pasted on" rather than painted/photographed in the same style)
  (2) It matches one of the listed third-party generator / stock-service / overlay-text patterns by name or specific visual signature
  (3) It is positioned as an OVERLAY (small, in a corner, or repeated/tiled across the image), not as a compositional element of the scene

If any of (1)–(3) is unmet, return decision: "allow". The Gemini sparkle in particular has a metallic blue/purple gradient and a sharp digital quality that is OBVIOUSLY different from any painterly artwork. Painted suns, sunbursts, mandalas, and glowing orbs in fantasy / tarot / gothic / Pre-Raphaelite / Klimt-style art are NOT Gemini watermarks. Err on ALLOW for painterly art.

Respond ONLY in this JSON, no markdown fences, no preamble:
{
  "ai_judgment": {
    "decision": "ai" | "human",
    "confidence": "high" | "medium" | "low",
    "likely_generator": "<MJ | DALL-E | SDXL | Flux | Firefly | other / null if human>",
    "tells": ["<short observations from the image>"],
    "reasoning": "<one or two sentences>"
  },
  "brand_judgment": {
    "brands_detected": [
      { "name": "<brand>", "evidence": "<what you saw>", "confidence": "high"|"medium"|"low", "verified_via_search": true|false }
    ],
    "decision": "block" | "allow",
    "reasoning": "<one or two sentences>"
  },
  "watermark_judgment": {
    "watermarks_detected": [
      { "type": "stock_preview" | "ai_generator" | "stock_agency" | "generic_overlay" | "artist_signature" | "other",
        "text": "<the visible text or what you saw>",
        "is_third_party": true | false,
        "tiled_or_repeating": true | false }
    ],
    "decision": "block" | "allow",
    "reasoning": "<one or two sentences>"
  }
}`;

async function callVisionLLM({ model, dataUrl, label }) {
  const body = {
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    }],
    temperature: 0,
    max_tokens: 800,
  };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "HTTP-Referer": "https://donottrain.vercel.app",
      "X-Title": "DoNotTrain Classification",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${label} (${model}) error ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);

  const content = json.choices?.[0]?.message?.content ?? "";
  const citations = json.citations ?? json.choices?.[0]?.message?.citations ?? [];
  const stripped = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  let parsed;
  try { parsed = JSON.parse(stripped); }
  catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = null; } }
  }
  const safe = parsed && typeof parsed === "object" ? parsed : {};
  return {
    label,
    model,
    ai: safe.ai_judgment ?? { decision: "human", confidence: "low", tells: [], reasoning: "(no ai_judgment returned)" },
    brand: safe.brand_judgment ?? { brands_detected: [], decision: "allow", reasoning: "(no brand_judgment returned)" },
    watermark: safe.watermark_judgment ?? { watermarks_detected: [], decision: "allow", reasoning: "(no watermark_judgment returned)" },
    citations,
  };
}

const VLM_MODELS = [
  { label: "sonar",  model: "perplexity/sonar-pro" },
  { label: "claude", model: "anthropic/claude-opus-4-7:online" },
];

// ── Florence-2 OCR for brand-text recovery ───────────────────────────────
// Frontier vision LLMs downscale images to ~1024–1568 px on the long edge,
// which makes small storefront text in dense city-street collages
// unreadable. Florence-2 OCR runs locally at native resolution and recovers
// the brand text those LLMs can't see. We then ship the OCR'd text to
// Sonar (text-only) for brand identification with web search.

const FLORENCE_MODEL = "onnx-community/Florence-2-base";
let florence, florenceProcessor, florenceTokenizer;
async function loadFlorence() {
  if (florence) return;
  process.stderr.write(`     loading Florence-2 OCR (uint8 quantized)…\n`);
  florence = await Florence2ForConditionalGeneration.from_pretrained(FLORENCE_MODEL, {
    dtype: {
      embed_tokens: "quantized",
      vision_encoder: "quantized",
      encoder_model: "quantized",
      decoder_model_merged: "quantized",
    },
    device: "cpu",
  });
  florenceProcessor = await AutoProcessor.from_pretrained(FLORENCE_MODEL);
  florenceTokenizer = await AutoTokenizer.from_pretrained(FLORENCE_MODEL);
}

// Florence-2 OCR is bundled but only used as a corroborator. It hallucinates
// brand names on images that contain NO text (interprets brushwork patterns
// as text). We trust it ONLY when its output overlaps with Claude vision OCR.
async function florenceOCR(imagePath) {
  await loadFlorence();
  const image = await RawImage.read(imagePath);
  const visionInputs = await florenceProcessor(image);
  const prompts = florenceProcessor.construct_prompts("<OCR>");
  const textInputs = florenceTokenizer(prompts);
  const generated = await florence.generate({
    ...textInputs, ...visionInputs,
    max_new_tokens: 512, num_beams: 3, do_sample: false,
  });
  const decoded = florenceTokenizer.batch_decode(generated, { skip_special_tokens: false })[0];
  const result = florenceProcessor.post_process_generation(decoded, "<OCR>", image.size);
  return String(result?.["<OCR>"] ?? "").trim();
}

// Claude vision OCR. More expensive than Florence-2 but won't hallucinate
// brand names on text-free images — Claude returns "NONE" honestly when the
// image has no readable text. Used as the authoritative OCR source.
async function claudeOCR(imagePath, mime) {
  const bytes = await readFile(imagePath);
  const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
  const body = {
    model: "anthropic/claude-sonnet-4-6",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Read every readable text string in this image — sign text, neon, product labels, storefront names, banners, captions, written words, AND any faint / translucent / repeated / diagonal watermark text overlays (e.g., 'envato', 'shutterstock', 'getty', 'PROOF', 'SAMPLE', 'PREVIEW' tiled across the image — these are often low-contrast and easy to miss but they are real text and you must read them). Return ONLY the raw text strings, one per line, exactly as written. Include every sign you can read no matter how small or faint. If the image contains NO readable text at all (a pure painting / abstract art / landscape with no text and no watermark), respond with the single word: NONE. DO NOT invent or hallucinate text that is not actually visible." },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    }],
    temperature: 0,
    max_tokens: 600,
  };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "HTTP-Referer": "https://donottrain.vercel.app",
      "X-Title": "DoNotTrain Claude OCR",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`claude OCR error ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  const content = (json.choices?.[0]?.message?.content ?? "").trim();
  if (/^none\.?$/i.test(content)) return "";
  return content;
}

const BRAND_FROM_OCR_PROMPT = `You will receive a list of text strings extracted by an OCR model from an image (one per line, possibly garbled). Identify which strings name popular commercial brands or trademarked logos.

Use web search if uncertain about whether a string is a real brand. Be inclusive — Japanese / Chinese / Korean brand names count.

Respond ONLY in JSON, no markdown fences:
{
  "brands": ["<brand 1>", "<brand 2>", ...],
  "decision": "block" | "allow",
  "reasoning": "<one sentence>"
}

Decision rule: if the brands array has 3 or more entries, decision = "block". Otherwise "allow".`;

async function brandFromOCR(ocrText) {
  if (!ocrText || ocrText.length < 3) {
    return { brands: [], decision: "allow", reasoning: "(no OCR text)", citations: [] };
  }
  const body = {
    model: "perplexity/sonar-pro",
    messages: [
      { role: "system", content: BRAND_FROM_OCR_PROMPT },
      { role: "user", content: `OCR text from image:\n${ocrText}` },
    ],
    temperature: 0,
    max_tokens: 400,
  };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "HTTP-Referer": "https://donottrain.vercel.app",
      "X-Title": "DoNotTrain Brand-from-OCR",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`brand-from-OCR error ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  const content = json.choices?.[0]?.message?.content ?? "";
  const citations = json.citations ?? json.choices?.[0]?.message?.citations ?? [];
  const stripped = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed;
  try { parsed = JSON.parse(stripped); }
  catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = null; } }
  }
  return {
    brands: parsed?.brands ?? [],
    decision: parsed?.decision ?? "allow",
    reasoning: parsed?.reasoning ?? null,
    citations,
  };
}

// ── Corner-watermark check ───────────────────────────────────────────────
// Vision LLMs downscale images to ~1024 px on the long edge before processing.
// A 30-px Gemini sparkle in a 1500-px image becomes ~20 px in the model's
// view, easily missed. We crop the bottom-right + bottom-left corners of the
// image, upscale them, and run a focused watermark-detection prompt on each.

const CORNER_PROMPT = `This is a corner crop of a larger image, cropped and upscaled so you can examine fine detail.

**MANDATORY PRE-CHECK:** First, what medium is this corner from?
  - **Real photograph** (a real city street with neon signs, a real interior, a real landscape) → return watermark_found: false UNLESS you can read a clear stock-agency name (Shutterstock, Getty, etc.) as TEXT. Real photos never have AI generator watermarks. A bright star-shaped sign or neon icon in a Tokyo/Times Square photo is a SIGN, not a Gemini watermark.
  - **Painterly artwork** (oil painting, fantasy illustration, gothic art, tarot, ukiyo-e) → return watermark_found: false. Painterly art is never watermarked by AI generators; any sun/star/sparkle is part of the painting.
  - **Photo-realistic AI output** (looks like a Gemini / DALL·E / MJ photo) → THIS is where Gemini sparkles, DALL·E rainbow stripes, etc. live. Look here.

You are looking for a watermark or stamp ADDED BY A THIRD PARTY ON TOP OF the image. Look specifically for:
  - A small four-pointed iridescent sparkle/star (like ✦ or ✧) with a metallic blue/purple/teal gradient finish AND visually disconnected from the surrounding artwork (different rendering style, looks pasted on) — the Google Gemini / Imagen watermark.
  - A horizontal row of 5 small colored squares (red, orange, yellow, green, blue) — DALL·E 3 / ChatGPT image rainbow stripe.
  - "Adobe Firefly" text or the stylized Firefly icon.
  - Microsoft "Designer" or Bing Image Creator badge.
  - "Sora" text or OpenAI logo mark.
  - Stock agency name (Shutterstock, Getty, iStock, Adobe Stock, Alamy, Dreamstime, 123RF, Depositphotos, Stocksy, EyeEm, Bigstock, AP, Reuters, Envato).
  - "PROOF", "SAMPLE", "PREVIEW", "COPY", "WATERMARK", "DEMO", "COMP" overlay text.
  - Any other small icon or stamp that looks like a service or AI brand mark.

DO NOT FLAG (return watermark_found: false) when you see:
  - **Painterly art with celestial elements**: a sun, moon, star, sunburst, mandala, halo, or glowing orb rendered with brushwork in oil-painting / illustration / fantasy / tarot / gothic style. These are NEVER watermarks — they are part of the painting. The Gemini watermark only appears on photo-realistic Google Gemini outputs and is a sharp digital metallic sparkle, never a brush-painted celestial element. Painted sun in a Klimt-like fantasy painting = ALLOW.
  - **Storefront / building signs, neon ads, billboards, sign icons** visible in a real photographed city/street scene — that's scene content, not a watermark overlay. A neon sign that looks star-shaped on a Shibuya storefront is NOT a Gemini sparkle; it is a sign.
  - **Black letterbox bars** or thin gray UI/browser chrome strips at the edges (screenshot framing).
  - **Subtle "© Name" artist signatures**.

KEY TEST: A real Gemini sparkle has all of these traits TOGETHER:
  (1) sharp digital edges, smooth metallic gradient, looks "pasted on" rather than painted
  (2) located clearly inside a margin/corner away from the main subject
  (3) the rest of the image is photo-realistic or illustrative in a non-painterly way (typical Gemini output)
If the image is an oil-painting or thick-brushwork illustration, ANY sun/star/sparkle in it is part of the painting. Return false. Only return true when the candidate element is unambiguously a sharp digital overlay distinct from the rest of the image.

Respond ONLY in JSON:
{
  "watermark_found": true | false,
  "type": "ai_generator" | "stock_agency" | "stock_preview" | "artist_signature" | "other" | null,
  "specific_mark": "<what you see, e.g. 'Gemini four-pointed sparkle' or 'DALL-E rainbow stripe' or null>",
  "text": "<any visible text, or null>",
  "reasoning": "<one sentence — explicitly note if you considered an element artwork vs watermark and why>"
}`;

async function cropCorner(filePath, corner /* "br" | "bl" | "tr" | "tl" */) {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(filePath).metadata();
  const w = meta.width || 1024;
  const h = meta.height || 1024;
  const cw = Math.max(80, Math.floor(w * 0.30));
  const ch = Math.max(80, Math.floor(h * 0.25));
  let left = 0, top = 0;
  switch (corner) {
    case "br": left = w - cw; top = h - ch; break;
    case "bl": left = 0;       top = h - ch; break;
    case "tr": left = w - cw; top = 0;      break;
    case "tl": left = 0;       top = 0;      break;
  }
  // Upscale to 768 px on long edge so small watermarks fill more of the
  // model's downscaled view.
  const buf = await sharp(filePath)
    .extract({ left, top, width: cw, height: ch })
    .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: false })
    .jpeg({ quality: 92 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

async function checkCornerWatermark(filePath, corner) {
  const dataUrl = await cropCorner(filePath, corner);
  const body = {
    model: "anthropic/claude-sonnet-4-6:online",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: CORNER_PROMPT },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    }],
    temperature: 0,
    max_tokens: 300,
  };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "HTTP-Referer": "https://donottrain.vercel.app",
      "X-Title": "DoNotTrain Corner Watermark Check",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`corner check error ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);

  const content = json.choices?.[0]?.message?.content ?? "";
  const stripped = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed;
  try { parsed = JSON.parse(stripped); }
  catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = null; } }
  }
  return {
    corner,
    watermark_found: !!parsed?.watermark_found,
    type: parsed?.type ?? null,
    specific_mark: parsed?.specific_mark ?? null,
    text: parsed?.text ?? null,
    reasoning: parsed?.reasoning ?? null,
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
if (args.length < 1) { console.error("usage: node scripts/batch-vlm-classify.mjs <input-dir> [output.pdf]"); process.exit(2); }
const inputDir = resolve(args[0]);
const outPdf = resolve(args[1] || "Classification-Report.pdf");

process.stderr.write(`[1/4] loading ${PIXEL_MODEL}…\n`);
const pixelClassifier = await pipeline("image-classification", PIXEL_MODEL);

process.stderr.write(`[2/4] scanning ${inputDir}…\n`);
const entries = (await readdir(inputDir, { withFileTypes: true }))
  .filter((d) => d.isFile())
  .map((d) => join(inputDir, d.name))
  .filter((p) => mimeFromExt(p))
  .sort();
process.stderr.write(`     ${entries.length} images found\n`);

process.stderr.write(`[3/4] classifying with 4-signal stack…\n`);
const results = [];
for (let i = 0; i < entries.length; i++) {
  const p = entries[i];
  const mime = mimeFromExt(p);
  process.stderr.write(`     [${i + 1}/${entries.length}] ${basename(p)}\n`);
  try {
    process.stderr.write(`         · c2pa…`);
    const c2pa = await readC2pa(p, mime);
    process.stderr.write(` ${c2pa.found ? (c2pa.isAI ? "AI" : "found-no-ai") : "none"}\n`);

    process.stderr.write(`         · organika pixel…`);
    const pix = await runPixel(pixelClassifier, p);
    process.stderr.write(` ${(pix.score * 100).toFixed(2)}% AI (${pix.label})\n`);

    const bytes = await readFile(p);
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

    process.stderr.write(`         · vision LLMs (${VLM_MODELS.map(v => v.label).join(", ")})…`);
    const settled = await Promise.allSettled(VLM_MODELS.map(({ label, model }) =>
      callVisionLLM({ model, dataUrl, label })
    ));
    const vlm = settled.map((r, idx) => r.status === "fulfilled" ? r.value : {
      label: VLM_MODELS[idx].label,
      model: VLM_MODELS[idx].model,
      ai: { decision: "human", confidence: "low", tells: [], reasoning: `(error: ${r.reason?.message ?? r.reason})` },
      brand: { brands_detected: [], decision: "allow", reasoning: `(error: ${r.reason?.message ?? r.reason})` },
      watermark: { watermarks_detected: [], decision: "allow", reasoning: `(error: ${r.reason?.message ?? r.reason})` },
      citations: [],
      error: r.reason?.message ?? String(r.reason),
    });
    process.stderr.write(` ${vlm.map(v => `${v.label}=ai:${v.ai.decision}/br:${v.brand.decision}(n=${v.brand.brands_detected?.length ?? 0})/wm:${v.watermark.decision}`).join(", ")}\n`);
    for (const v of vlm) {
      const names = (v.brand?.brands_detected ?? []).map(b => b?.name).filter(Boolean);
      if (names.length) process.stderr.write(`            ${v.label} brands: ${names.join(", ")}\n`);
    }

    // Focused corner-watermark scan on bottom-right + bottom-left.
    // Catches AI generator stamps that the full-image scan downscales away.
    // OCR-driven brand detection: Claude vision OCR (won't hallucinate on
    // text-free images) → Sonar text-only brand recognition with web search.
    process.stderr.write(`         · claude OCR + brand-from-OCR…`);
    let ocrText = "", ocrBrand = { brands: [], decision: "allow", reasoning: null, citations: [] };
    try {
      ocrText = await claudeOCR(p, mime);
      ocrBrand = await brandFromOCR(ocrText);
      process.stderr.write(` ${ocrBrand.decision.toUpperCase()} (${ocrBrand.brands.length} brands from ${ocrText.length} chars OCR)\n`);
      if (ocrBrand.brands.length) {
        process.stderr.write(`            ocr-brands: ${ocrBrand.brands.join(", ")}\n`);
      }
    } catch (e) {
      process.stderr.write(` ERROR: ${e?.message}\n`);
    }

    process.stderr.write(`         · corner watermark scan (br + bl)…`);
    const corners = await Promise.allSettled([
      checkCornerWatermark(p, "br"),
      checkCornerWatermark(p, "bl"),
    ]);
    const cornerResults = corners.map((r, idx) => r.status === "fulfilled"
      ? r.value
      : { corner: ["br", "bl"][idx], watermark_found: false, type: null, specific_mark: null, text: null, reasoning: `(error: ${r.reason?.message ?? r.reason})` });
    const cornerBlocked = cornerResults.some((c) =>
      c.watermark_found && (c.type === "ai_generator" || c.type === "stock_agency" || c.type === "stock_preview" || c.type === "generic_overlay" || c.type === "other"));
    process.stderr.write(` ${cornerResults.map(c => `${c.corner}=${c.watermark_found ? (c.specific_mark ?? c.type ?? "found") : "clean"}`).join(", ")}\n`);

    // AI is INFORMATIONAL ONLY — does not block. Tracked so the report
    // shows it but the overall verdict ignores it.
    const aiDetected =
      c2pa.isAI ||
      pix.score >= AI_THRESHOLD ||
      vlm.some((v) => v.ai?.decision === "ai");
    // Brand verdict: full-image VLM brand block OR OCR-recovered brand block.
    // The OCR path catches dense storefront text the VLMs can't read after
    // their internal downscale.
    const brandBlocked = vlm.some((v) => v.brand?.decision === "block") || ocrBrand.decision === "block";
    // Watermark voting:
    //   - Corner crop with a SPECIFIC NAMED watermark (Gemini, DALL·E, named
    //     stock agency, named overlay) → block alone. Specific names are
    //     high-confidence; the corner crop only fires on visible content.
    //   - Otherwise, require BOTH full-image LLMs (Sonar AND Claude) to
    //     agree on block. Vague single-LLM flags are noise-filtered out.
    const NAMED_GENERATORS = /gemini|dall|chatgpt|sora|firefly|designer|bing|imagen|midjourney|stability|sdxl|flux|leonardo|ideogram|playground|nightcafe|shutterstock|getty|istock|adobe stock|alamy|dreamstime|depositphotos|stocksy|eyeem|bigstock|reuters|envato|proof|sample|preview|copy|watermark|demo|comp/i;
    const cornerNamed = cornerResults.some((c) =>
      c.watermark_found &&
      (c.type === "ai_generator" || c.type === "stock_agency" || c.type === "stock_preview" || c.type === "generic_overlay") &&
      typeof c.specific_mark === "string" &&
      NAMED_GENERATORS.test(c.specific_mark)
    );
    const bothLLMsBlockWm =
      vlm[0]?.watermark?.decision === "block" &&
      vlm[1]?.watermark?.decision === "block";
    // Single-LLM block is sufficient IF that LLM specifically NAMES a known
    // stock service / AI generator in its watermarks_detected array or
    // reasoning. Catches subtle Envato / Shutterstock / Gemini-named hits
    // that the second LLM missed without re-introducing vague single-flag
    // false positives (which had no specific named match).
    const namedWmInVlm = vlm.some((v) => {
      if (v.watermark?.decision !== "block") return false;
      const blob = JSON.stringify(v.watermark?.watermarks_detected ?? []) + " " + (v.watermark?.reasoning ?? "");
      return NAMED_GENERATORS.test(blob);
    });
    const watermarkBlocked = cornerNamed || bothLLMsBlockWm || namedWmInVlm;
    const overall = (brandBlocked || watermarkBlocked) ? "block" : "allow";

    results.push({
      path: p, mime, c2pa, pix, vlm, cornerResults,
      ocrText, ocrBrand,
      aiDetected, brandBlocked, watermarkBlocked, cornerBlocked, overall,
    });
  } catch (e) {
    process.stderr.write(`         · ERROR: ${e?.message}\n`);
    results.push({ path: p, mime, error: e?.message });
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────
process.stderr.write(`[4/4] writing ${outPdf}…\n`);

const PAGE_W = 612, PAGE_H = 792, MARGIN = 48;

const pdf = new jsPDF({ unit: "pt", format: "letter" });
pdf.setProperties({
  title: "DoNotTrain Classification Report",
  subject: "Per-image AI + Brand verdicts (4-signal stack)",
  creator: "DoNotTrain",
});

const blocked = results.filter((r) => r.overall === "block").length;
const allowed = results.filter((r) => r.overall === "allow").length;
const errors = results.filter((r) => r.error).length;

// Cover
pdf.setFont("helvetica", "bold");
pdf.setFontSize(22);
pdf.setTextColor(20, 20, 20);
pdf.text("DoNotTrain Classification Report", MARGIN, 110);

pdf.setFont("helvetica", "normal");
pdf.setFontSize(10);
pdf.setTextColor(120, 120, 120);
pdf.text(`Source folder: ${inputDir}`, MARGIN, 130);
pdf.text(`Signal 1: C2PA Content Credentials (instant, signed metadata)`, MARGIN, 144);
pdf.text(`Signal 2: ${PIXEL_MODEL}  (local pixel classifier, threshold ${AI_THRESHOLD * 100}%)`, MARGIN, 158);
pdf.text(`Signal 3: openrouter / ${VLM_MODELS[0].model}  (vision + native search)`, MARGIN, 172);
pdf.text(`Signal 4: openrouter / ${VLM_MODELS[1].model}  (vision + Exa search)`, MARGIN, 186);
pdf.text(`Signal 5: corner-crop watermark scan (bottom-right + bottom-left, upscaled, focused prompt)`, MARGIN, 200);
pdf.text(`AI = informational. BLOCK overall if brand or watermark fires. Watermark = full scan OR corner crop.`, MARGIN, 214);

pdf.setDrawColor(220, 220, 220);
pdf.setFillColor(247, 247, 248);
pdf.roundedRect(MARGIN, 234, PAGE_W - 2 * MARGIN, 100, 6, 6, "FD");

pdf.setFont("helvetica", "bold");
pdf.setFontSize(11);
pdf.setTextColor(80, 80, 80);
pdf.text("OVERALL", MARGIN + 16, 256);

pdf.setFont("helvetica", "normal");
pdf.setFontSize(10);
pdf.setTextColor(40, 40, 40);
const sx = MARGIN + 16;
pdf.text(`Total:`, sx, 282);   pdf.text(`${results.length}`, sx + 120, 282);
pdf.text(`Blocked:`, sx, 300); pdf.setTextColor(180, 30, 30); pdf.text(`${blocked}`, sx + 120, 300);
pdf.setTextColor(40, 40, 40);
pdf.text(`Allowed:`, sx, 318); pdf.setTextColor(30, 130, 50); pdf.text(`${allowed}`, sx + 120, 318);
if (errors) { pdf.setTextColor(150, 90, 0); pdf.text(`Errors: ${errors}`, sx + 200, 282); }
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
  pdf.text("DoNotTrain · 4-signal classification", PAGE_W - MARGIN, 20, { align: "right" });

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
        imgW = meta.width || imgW; imgH = meta.height || imgH;
      } catch {}
      const maxW = PAGE_W - 2 * MARGIN, maxH = 240;
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

  // badges
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
    // AI badge is a binary YES/NO — informational only, does not block.
    // Slate-blue when AI detected, neutral gray-green when not.
    const aiBadge = r.aiDetected
      ? { text: "AI: YES", fill: [232, 240, 252], draw: [60, 90, 180], fg: [60, 90, 180] }
      : { text: "AI: NO",  fill: [240, 245, 240], draw: [80, 130, 90], fg: [40, 90, 50] };
    const brandBadge = r.brandBlocked
      ? { text: "BRAND · BLOCKED", fill: [252, 232, 232], draw: [180, 30, 30], fg: [180, 30, 30] }
      : { text: "NO BRAND · OK",   fill: [232, 248, 234], draw: [30, 130, 50], fg: [30, 130, 50] };
    const wmBadge = r.watermarkBlocked
      ? { text: "WATERMARK · BLOCKED", fill: [252, 232, 232], draw: [180, 30, 30], fg: [180, 30, 30] }
      : { text: "NO WATERMARK · OK",   fill: [232, 248, 234], draw: [30, 130, 50], fg: [30, 130, 50] };
    const overallBadge = r.overall === "block"
      ? { text: "OVERALL · BLOCKED", fill: [180, 30, 30], draw: [180, 30, 30], fg: [255, 255, 255] }
      : { text: "OVERALL · ALLOWED", fill: [30, 130, 50], draw: [30, 130, 50], fg: [255, 255, 255] };

    let bx = MARGIN;
    bx += drawBadge(aiBadge.text, bx, aiBadge.fill, aiBadge.draw, aiBadge.fg) + 6;
    bx += drawBadge(brandBadge.text, bx, brandBadge.fill, brandBadge.draw, brandBadge.fg) + 6;
    // Watermark badge wraps to next line if there isn't room
    const wmW = pdf.getTextWidth(wmBadge.text) + 24;
    if (bx + wmW > PAGE_W - MARGIN) {
      y += 28; bx = MARGIN;
    }
    bx += drawBadge(wmBadge.text, bx, wmBadge.fill, wmBadge.draw, wmBadge.fg) + 6;
    const ovW = pdf.getTextWidth(overallBadge.text) + 24;
    if (bx + ovW > PAGE_W - MARGIN) {
      y += 28; bx = MARGIN;
    }
    drawBadge(overallBadge.text, bx, overallBadge.fill, overallBadge.draw, overallBadge.fg);
    y += 32;
  }

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
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text("AI SIGNALS", labelX, y);
    y += 14;

    row("C2PA",
      r.c2pa.found
        ? (r.c2pa.isAI ? `Found, declares AI` : "Found, no AI claim")
        : "Not present");
    if (r.c2pa.generator) row("  generator", r.c2pa.generator);
    if (r.c2pa.digitalSourceType) row("  digital src", r.c2pa.digitalSourceType);
    row("Pixel score", `${(r.pix.score * 100).toFixed(2)}% AI (${r.pix.label})`,
      r.pix.score >= AI_THRESHOLD ? [180, 30, 30] : [30, 30, 30]);

    for (const v of r.vlm) {
      const aiTxt = `${(v.ai.decision ?? "?").toUpperCase()} (${v.ai.confidence ?? "?"})${v.ai.likely_generator && v.ai.likely_generator !== "null" ? ` — likely: ${v.ai.likely_generator}` : ""}${v.ai.reasoning ? " — " + v.ai.reasoning : ""}`;
      row(`${v.label}`, aiTxt, v.ai.decision === "ai" ? [180, 30, 30] : [30, 30, 30]);
      if (Array.isArray(v.ai.tells) && v.ai.tells.length) {
        row(`  tells`, v.ai.tells.join("; "));
      }
    }

    y += 6;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text("BRAND SIGNALS", labelX, y);
    y += 14;

    for (const v of r.vlm) {
      const decision = v.brand?.decision ?? "allow";
      const txt = `${decision.toUpperCase()}${v.brand?.reasoning ? " — " + v.brand.reasoning : ""}`;
      row(`${v.label}`, txt, decision === "block" ? [180, 30, 30] : [30, 30, 30]);
      for (const b of v.brand?.brands_detected ?? []) {
        const bt = `• ${b.name} — ${b.evidence ?? ""} [conf ${b.confidence ?? "?"}, search ${b.verified_via_search ? "yes" : "no"}]`;
        row(`  brand`, bt);
      }
    }

    y += 6;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text("WATERMARK SIGNALS", labelX, y);
    y += 14;

    for (const v of r.vlm) {
      const decision = v.watermark?.decision ?? "allow";
      const txt = `${decision.toUpperCase()}${v.watermark?.reasoning ? " — " + v.watermark.reasoning : ""}`;
      row(`${v.label}`, txt, decision === "block" ? [180, 30, 30] : [30, 30, 30]);
      for (const w of v.watermark?.watermarks_detected ?? []) {
        const wt = `• ${w.type ?? "?"} — "${w.text ?? ""}" [third-party: ${w.is_third_party ? "yes" : "no"}, repeating: ${w.tiled_or_repeating ? "yes" : "no"}]`;
        row(`  mark`, wt);
      }
    }
    // Corner-crop scan results
    for (const c of r.cornerResults ?? []) {
      const txt = c.watermark_found
        ? `BLOCK — ${c.specific_mark ?? c.type ?? "watermark"}${c.text ? ` ("${c.text}")` : ""} — ${c.reasoning ?? ""}`
        : `clean${c.reasoning ? " — " + c.reasoning : ""}`;
      row(`corner ${c.corner}`, txt, c.watermark_found ? [180, 30, 30] : [30, 30, 30]);
    }

    // citations from any model
    const allCitations = r.vlm.flatMap((v) =>
      (v.citations ?? []).map((c) => typeof c === "string" ? c : (c?.url ?? null)).filter(Boolean)
    );
    const uniqueCitations = [...new Set(allCitations)].slice(0, 5);
    if (uniqueCitations.length) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(120, 120, 120);
      pdf.text("Sources", labelX, y);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(40, 90, 200);
      let yy = y;
      for (const url of uniqueCitations) {
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
  total: results.length, blocked, allowed, errors, output: outPdf,
}, null, 2));
