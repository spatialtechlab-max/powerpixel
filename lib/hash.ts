import type { Hex } from "viem";

/**
 * SHA-256 of a File using the browser-native Web Crypto API.
 * Returns a 0x-prefixed 64-hex-char string suitable for Solidity bytes32.
 *
 * The file is read into an ArrayBuffer in-memory only — nothing is uploaded.
 */
export async function sha256OfFile(file: File): Promise<Hex> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return toHex(new Uint8Array(hashBuffer));
}

export function toHex(bytes: Uint8Array): Hex {
  let out = "0x";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out as Hex;
}

export function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

export function shortHex(hex: string, leading = 6, trailing = 4): string {
  if (hex.length <= leading + trailing + 2) return hex;
  return `${hex.slice(0, 2 + leading)}…${hex.slice(-trailing)}`;
}

/**
 * Convert an image File to a JPEG data URL via canvas.
 *
 * Normalizes whatever the user dropped (PNG, JPEG, WEBP, GIF…) into a
 * JPEG data URL the PDF generator can reliably embed. Long side is
 * downscaled to `maxDim` to keep the PDF a sane size.
 */
export async function fileToJpegDataURL(file: File, maxDim = 1600): Promise<string> {
  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = (e) => reject(e);
      im.src = blobUrl;
    });

    const longSide = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = longSide > maxDim ? maxDim / longSide : 1;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    // White background under transparent PNGs so they don't become black in JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
