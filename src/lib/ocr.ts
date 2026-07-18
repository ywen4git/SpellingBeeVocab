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

/** Upscale small screenshots 2x — tesseract accuracy drops on small text. */
async function toRecognizable(file: File): Promise<File | HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  if (Math.min(bitmap.width, bitmap.height) >= 1000) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width * 2;
  canvas.height = bitmap.height * 2;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

export async function recognizeImage(
  file: File,
  onProgress: (p: OcrProgress) => void,
): Promise<string> {
  onProgress({ label: 'Loading OCR engine…', progress: 0 });
  let worker: Worker;
  try {
    worker = await getWorker();
  } catch (err) {
    workerPromise = null; // allow retry after a failed load
    throw new OcrError(`OCR engine failed to load: ${String(err)}`);
  }
  currentOnProgress = onProgress;
  try {
    const input = await toRecognizable(file);
    const { data } = await worker.recognize(input);
    return data.text;
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
