import { createWorker, type Worker } from 'tesseract.js';

export interface OcrProgress {
  label: string;
  progress: number; // 0..1
}

export class OcrError extends Error {}

let workerPromise: Promise<Worker> | null = null;
let currentOnProgress: ((p: OcrProgress) => void) | null = null;

const assetBase = `${import.meta.env.BASE_URL}tesseract/`;

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker('eng', 1, {
    workerPath: `${assetBase}worker.min.js`,
    corePath: assetBase,
    langPath: assetBase,
    logger: (m) => {
      if (m.status === 'recognizing text') {
        currentOnProgress?.({ label: 'Reading words…', progress: m.progress });
      }
    },
  });
  return workerPromise;
}

/**
 * Screenshots are recognized at native resolution. An earlier version
 * upscaled anything under 1000px on the assumption that small text hurts
 * tesseract's accuracy, but on real screenshots (~768px is a typical phone
 * screenshot width — the common case, not an edge case) upscaling actively
 * destroyed the hive letter row's low-contrast gold glyph regardless of
 * interpolation kernel, while providing no measurable benefit to the rest
 * of the text. Verified against real screenshots before removing.
 */
async function toCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

/**
 * Grayscale + contrast-stretch + hard threshold. Recovers faint/low-contrast
 * text (e.g. a word mid-fade-in on the app's reveal screen) that the
 * unmodified screenshot's OCR pass misses — at the cost of wiping out the
 * hive letter row's distinct gold color, which is why this is only ever run
 * as a second, additional OCR pass rather than a replacement for the first.
 */
function boostContrast(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext('2d')!;
  const { width, height } = source;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const pixelCount = width * height;
  const gray = new Float64Array(pixelCount);
  let min = 255;
  let max = 0;
  for (let i = 0; i < pixelCount; i++) {
    const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    gray[i] = lum;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  const range = Math.max(max - min, 1);
  const threshold = 180;
  for (let i = 0; i < pixelCount; i++) {
    const normalized = ((gray[i] - min) / range) * 255;
    const v = normalized >= threshold ? 255 : 0;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
  }
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  out.getContext('2d')!.putImageData(imageData, 0, 0);
  return out;
}

export interface OcrResult {
  text: string;
  /** Second pass over a contrast-boosted copy; see boostContrast(). */
  boostedText: string;
}

export async function recognizeImage(
  file: File,
  onProgress: (p: OcrProgress) => void,
): Promise<OcrResult> {
  onProgress({ label: 'Loading OCR engine…', progress: 0 });
  let worker: Worker;
  try {
    worker = await getWorker();
  } catch (err) {
    workerPromise = null; // allow retry after a failed load
    throw new OcrError(`OCR engine failed to load: ${String(err)}`);
  }
  try {
    currentOnProgress = (p) => onProgress({ label: 'Reading words…', progress: p.progress * 0.5 });
    const { data: pass1 } = await worker.recognize(file);

    const boosted = boostContrast(await toCanvas(file));
    currentOnProgress = (p) => onProgress({ label: 'Reading faint words…', progress: 0.5 + p.progress * 0.5 });
    const { data: pass2 } = await worker.recognize(boosted);

    return { text: pass1.text, boostedText: pass2.text };
  } catch (err) {
    throw new OcrError(`Recognition failed: ${String(err)}`);
  } finally {
    currentOnProgress = null;
  }
}

/** Free the worker's memory when leaving the Add tab. */
export async function terminateOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (p) await (await p).terminate();
}
