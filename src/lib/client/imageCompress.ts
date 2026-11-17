'use client';
// Client-side photo compression (doc 02 section 6.6): long edge <= 1600 px, JPEG 0.85.
// Re-encoding through a canvas strips EXIF (including GPS). Orientation is applied while decoding.

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.85;

/** Scale (w, h) down so the long edge is at most `max`. Never upscales. Returns whole pixels (>= 1). */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 1, height: 1 };
  const long = Math.max(w, h);
  if (long <= max) return { width: Math.round(w), height: Math.round(h) };
  const k = max / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not read this image'));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Decode, orient, downscale to <= 1600 px and re-encode as JPEG 0.85. */
export async function compressImage(file: File): Promise<Blob> {
  const d = await decode(file);
  try {
    const { width, height } = fitWithin(d.width, d.height, MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.fillStyle = '#fff'; // JPEG has no alpha
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(d.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('Could not compress this image');
    return blob;
  } finally {
    d.release();
  }
}
