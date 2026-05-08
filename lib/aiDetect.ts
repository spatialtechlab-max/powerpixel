"use client";

/**
 * AI-generation detection. Two stacked signals, both run entirely in the browser.
 *
 * 1) C2PA Content Credentials manifest read.
 *    DALL·E 3 / ChatGPT / Sora 2 / Adobe Firefly / Imagen / Midjourney attach
 *    a signed manifest to every output. We block on either a known AI generator
 *    name (claim_generator / claim_generator_info[].name) OR an action carrying
 *    a `trainedAlgorithmic*` / `algorithmicMedia` / `compositeSynthetic`
 *    digitalSourceType (the IPTC vocabulary the C2PA spec uses for AI provenance).
 *
 * 2) Pixel-level classifier.
 *    `Organika/sdxl-detector` ONNX (Swin, FP32, ~340 MB cached in IndexedDB
 *    after first load), via Transformers.js. ~94% accuracy on SDXL,
 *    Midjourney, Flux. Weak on ChatGPT/DALL·E (different architecture from
 *    SDXL, so signal 1 above carries that family). Score >= 0.4 triggers a
 *    block (aggressive threshold by project policy).
 *
 * The file never leaves the browser. No upload, no fetch of pixels — only the
 * model weights are pulled (and cached in IndexedDB by Transformers.js).
 */

export const AI_DETECTION_THRESHOLD = 0.4;

const PIXEL_MODEL = "Organika/sdxl-detector";

const AI_GENERATOR_NEEDLES = [
  "dall",
  "openai",
  "chatgpt",
  "sora",
  "firefly",
  "adobe firefly",
  "imagen",
  "midjourney",
  "stable diffusion",
  "stability",
  "sdxl",
  "flux",
  "bing image creator",
  "veo",
  "runway",
  "leonardo",
  "ideogram",
  "playground",
  "nightcafe",
];

const AI_DIGITAL_SOURCE_NEEDLES = [
  "trainedalgorithmicmedia",
  "trainedalgorithmicdata",
  "compositewithtrainedalgorithmicmedia",
  "algorithmicmedia",
  "algorithmicallyenhanced",
  "compositesynthetic",
  "datadrivenmedia",
];

export type AIDetectionVerdict = "human" | "ai";

export interface AIDetectionResult {
  verdict: AIDetectionVerdict;
  classifierScore: number;
  classifierLabel: string | null;
  c2paFound: boolean;
  c2paClaimsAI: boolean;
  c2paGenerator: string | null;
  c2paDigitalSource: string | null;
  reasons: string[];
}

interface C2paResult {
  found: boolean;
  isAI: boolean;
  generator: string | null;
  digitalSourceType: string | null;
}

let pipelinePromise: Promise<unknown> | null = null;
let c2paPromise: Promise<unknown> | null = null;

/**
 * Kick off model downloads in the background. Safe to call repeatedly.
 */
export function preloadAIDetector(): void {
  void loadPipeline().catch(() => {});
  void loadC2pa().catch(() => {});
}

async function loadPipeline(): Promise<unknown> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const tx = await import("@huggingface/transformers");
      const { pipeline, env } = tx as unknown as {
        pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<unknown>;
        env: { allowLocalModels: boolean; useBrowserCache: boolean };
      };
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      return await pipeline("image-classification", PIXEL_MODEL);
    })();
  }
  return pipelinePromise;
}

async function loadC2pa(): Promise<unknown> {
  if (!c2paPromise) {
    c2paPromise = (async () => {
      const mod = await import("@contentauth/c2pa-web/inline");
      return await mod.createC2pa();
    })();
  }
  return c2paPromise;
}

interface C2paManifest {
  claim_generator?: string | null;
  claim_generator_info?: Array<{ name?: string }> | null;
  assertions?: Array<{ label?: string; data?: unknown }> | null;
}

interface C2paStore {
  active_manifest?: string | null;
  manifests?: Record<string, C2paManifest> | null;
}

/**
 * Walk every manifest in the store (active + ingredients) and look for AI
 * signals. ChatGPT's export pipeline buries `digitalSourceType:
 * trainedAlgorithmicMedia` in the ingredient manifest (the raw GPT-4o output),
 * not the active one (which is the ChatGPT export wrapper). Walking only the
 * active manifest misses that case if the file ever passes through an editor.
 */
function scanManifestStore(store: C2paStore | null): C2paResult {
  const empty: C2paResult = { found: false, isAI: false, generator: null, digitalSourceType: null };
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

  let generatorMatch: string | null = null;
  let digitalSource: string | null = null;

  for (const m of manifests) {
    const blob = [
      m.claim_generator ?? "",
      ...(m.claim_generator_info ?? []).map((g) => g?.name ?? ""),
    ]
      .join(" ")
      .toLowerCase();
    if (!generatorMatch) {
      const hit = AI_GENERATOR_NEEDLES.find((n) => blob.includes(n));
      if (hit) generatorMatch = hit;
    }

    for (const a of m.assertions ?? []) {
      if (!a?.label) continue;
      if (!/c2pa\.actions/.test(a.label)) continue;
      const data = a.data as { actions?: Array<{ digitalSourceType?: string | null }> } | undefined;
      for (const action of data?.actions ?? []) {
        const dst = action.digitalSourceType?.toLowerCase() ?? "";
        if (AI_DIGITAL_SOURCE_NEEDLES.some((n) => dst.includes(n))) {
          digitalSource = action.digitalSourceType ?? null;
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

async function readC2pa(file: File): Promise<C2paResult> {
  const empty: C2paResult = { found: false, isAI: false, generator: null, digitalSourceType: null };
  try {
    const sdk = (await loadC2pa()) as {
      reader: { fromBlob: (format: string, blob: Blob) => Promise<unknown> };
    };
    const reader = await sdk.reader.fromBlob(file.type || "image/jpeg", file);
    if (!reader) return empty;

    const r = reader as {
      manifestStore: () => Promise<C2paStore>;
      free: () => Promise<void>;
    };
    try {
      const store = await r.manifestStore();
      return scanManifestStore(store);
    } finally {
      await r.free();
    }
  } catch {
    return empty;
  }
}

interface ClassifierHit {
  label: string;
  score: number;
}

async function runPixelClassifier(file: File): Promise<ClassifierHit> {
  const classifier = (await loadPipeline()) as (
    input: string,
  ) => Promise<Array<{ label: string; score: number }>>;
  const url = URL.createObjectURL(file);
  try {
    const out = await classifier(url);
    // umm-maybe/AI-image-detector returns labels "artificial" and "human".
    // Match defensively across naming variants other detectors might emit.
    const aiHit = out.find((r) =>
      /artificial|^ai$|generated|synthetic|fake|deepfake/i.test(r.label),
    );
    if (aiHit) return aiHit;
    // Last resort: take the highest-scored label and treat it as AI if its
    // name is not "human" / "real" / "natural".
    const top = [...out].sort((a, b) => b.score - a.score)[0];
    if (!top) return { label: "unknown", score: 0 };
    if (/human|real|natural|authentic|photo/i.test(top.label)) {
      return { label: top.label, score: 1 - top.score };
    }
    return top;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Two-stage detection. C2PA manifest signals win and short-circuit the
 * pixel classifier — they are signed by the generator itself and have no
 * meaningful false-positive rate. The pixel classifier acts as the
 * fallback for unsigned outputs and re-saved files.
 */
export async function detectAI(file: File): Promise<AIDetectionResult> {
  const reasons: string[] = [];
  const c2pa = await readC2pa(file);

  if (c2pa.isAI) {
    if (c2pa.generator) {
      reasons.push(
        `Content Credentials manifest declares this asset was produced by ${c2pa.generator}.`,
      );
    }
    if (c2pa.digitalSourceType) {
      reasons.push(
        `C2PA action carries digitalSourceType ${c2pa.digitalSourceType}, which the IPTC vocabulary reserves for AI-generated media.`,
      );
    }
    return {
      verdict: "ai",
      classifierScore: 1,
      classifierLabel: null,
      c2paFound: c2pa.found,
      c2paClaimsAI: true,
      c2paGenerator: c2pa.generator,
      c2paDigitalSource: c2pa.digitalSourceType,
      reasons,
    };
  }

  const hit = await runPixelClassifier(file);

  if (hit.score >= AI_DETECTION_THRESHOLD) {
    reasons.push(
      `Pixel classifier returned a ${(hit.score * 100).toFixed(1)}% AI match against the threshold of ${(AI_DETECTION_THRESHOLD * 100).toFixed(0)}%.`,
    );
    if (c2pa.found) {
      reasons.push(
        "Content Credentials manifest is present but does not declare AI authorship; the pixel-level model still flagged this file.",
      );
    }
    return {
      verdict: "ai",
      classifierScore: hit.score,
      classifierLabel: hit.label,
      c2paFound: c2pa.found,
      c2paClaimsAI: false,
      c2paGenerator: c2pa.generator,
      c2paDigitalSource: c2pa.digitalSourceType,
      reasons,
    };
  }

  return {
    verdict: "human",
    classifierScore: hit.score,
    classifierLabel: hit.label,
    c2paFound: c2pa.found,
    c2paClaimsAI: false,
    c2paGenerator: c2pa.generator,
    c2paDigitalSource: c2pa.digitalSourceType,
    reasons: [],
  };
}
