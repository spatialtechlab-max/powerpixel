// Standalone Node smoke test for the AI-detection pixel classifier.
// Loads the same model the browser uses, runs it on a local file, prints
// the raw classifier output and our gate verdict.
//
// Run:  node scripts/test-ai-detect.mjs <path-to-image>

import { pipeline, env } from "@huggingface/transformers";

const PRIMARY = "Organika/sdxl-detector";
const THRESHOLD = 0.4;

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/test-ai-detect.mjs <image1> [image2] ...");
  process.exit(2);
}

env.allowLocalModels = false;
env.useBrowserCache = false;

process.stderr.write(`loading ${PRIMARY}…\n`);
const classifier = await pipeline("image-classification", PRIMARY);

for (const path of args) {
  process.stderr.write(`\n--- ${path} ---\n`);
  const out = await classifier(path);
  console.log(JSON.stringify({ file: path, raw: out }, null, 2));

  const aiHit = out.find((r) => /artificial|^ai$|generated|synthetic|fake|deepfake/i.test(r.label));
  let score, label;
  if (aiHit) {
    score = aiHit.score;
    label = aiHit.label;
  } else {
    const top = [...out].sort((a, b) => b.score - a.score)[0];
    if (/human|real|natural|authentic|photo/i.test(top.label)) {
      score = 1 - top.score;
      label = `derived from inverse of '${top.label}'`;
    } else {
      score = top.score;
      label = top.label;
    }
  }

  const verdict = score >= THRESHOLD ? "ai (BLOCK)" : "human (ALLOW)";
  console.log(
    JSON.stringify({
      file: path,
      verdict,
      score: +score.toFixed(4),
      label,
      threshold: THRESHOLD,
    }),
  );
}
