// Strip near-white background from a PNG/JPEG and write a transparent PNG.
// Usage: node scripts/remove-bg.mjs <input> <output> [whiteThreshold=235]

import sharp from "sharp";
const [, , input, output, thresholdArg] = process.argv;
if (!input || !output) {
  console.error("usage: node scripts/remove-bg.mjs <input> <output> [whiteThreshold=235]");
  process.exit(2);
}
const threshold = Number(thresholdArg ?? 235);

// Read raw RGBA pixels.
const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

// Two-pass alpha masking:
//   1. Hard-zero alpha for pixels brighter than `threshold` on all channels (pure background).
//   2. Soft-feather alpha for pixels in a 20-channel band below threshold so anti-aliased
//      edges don't get a halo.
const FEATHER = 20;
let zeroed = 0, softened = 0;
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const minRGB = Math.min(r, g, b);
  if (minRGB >= threshold) {
    data[i + 3] = 0;
    zeroed++;
  } else if (minRGB >= threshold - FEATHER) {
    const t = (minRGB - (threshold - FEATHER)) / FEATHER;
    data[i + 3] = Math.round(data[i + 3] * (1 - t));
    softened++;
  }
}

await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(output);

console.error(`zeroed ${zeroed} px, softened ${softened} px → ${output}`);
