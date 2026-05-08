// Verifies that c2pa-rs (same Rust core as @contentauth/c2pa-web) parses
// a ChatGPT image and surfaces the AI generator + digitalSourceType in the
// shape my browser-side detector parses.
//
// Run:  node scripts/test-c2pa.mjs <path-to-image>

import { readFile } from "node:fs/promises";
import { Reader } from "@contentauth/c2pa-node";

const path = process.argv[2];
if (!path) { console.error("usage: node scripts/test-c2pa.mjs <image>"); process.exit(2); }

const bytes = await readFile(path);
const ext = path.split(".").pop()?.toLowerCase();
const format = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
const reader = await Reader.fromAsset({ mimeType: format, buffer: bytes });
if (!reader) { console.log(JSON.stringify({ found: false }, null, 2)); process.exit(0); }

const store = reader.json();
const aiNeedles = ["dall","openai","chatgpt","sora","firefly","imagen","midjourney","stable diffusion","stability","sdxl","flux","veo","gpt"];
const aiSourceNeedles = ["trainedalgorithmicmedia","trainedalgorithmicdata","compositewithtrainedalgorithmicmedia","algorithmicmedia","algorithmicallyenhanced","compositesynthetic","datadrivenmedia"];

let generatorMatch = null;
let dsHit = null;
let dsHitVia = null;

for (const [label, m] of Object.entries(store.manifests ?? {})) {
  const blob = [
    m.claim_generator ?? "",
    ...(m.claim_generator_info ?? []).map((g) => g?.name ?? ""),
  ].join(" ").toLowerCase();
  if (!generatorMatch) {
    const hit = aiNeedles.find((n) => blob.includes(n));
    if (hit) generatorMatch = `${hit} (in ${label})`;
  }
  for (const a of m.assertions ?? []) {
    if (!/c2pa\.actions/.test(a.label ?? "")) continue;
    for (const action of a.data?.actions ?? []) {
      const dst = (action.digitalSourceType ?? "").toLowerCase();
      if (aiSourceNeedles.some((n) => dst.includes(n))) {
        dsHit = action.digitalSourceType;
        dsHitVia = `${a.label} in ${label}`;
        break;
      }
    }
    if (dsHit) break;
  }
}

console.log(JSON.stringify({
  found: true,
  active_manifest: store.active_manifest,
  manifest_labels: Object.keys(store.manifests ?? {}),
  generatorMatch,
  digitalSourceMatch: dsHit,
  digitalSourceMatchVia: dsHitVia,
  verdict: (generatorMatch || dsHit) ? "AI (BLOCK)" : "human (ALLOW)",
}, null, 2));
