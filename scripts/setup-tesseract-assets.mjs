import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(projectRoot, 'public', 'tesseract');
await mkdir(outDir, { recursive: true });

await copyFile(
  path.join(projectRoot, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
  path.join(outDir, 'worker.min.js'),
);

const coreDir = path.join(projectRoot, 'node_modules', 'tesseract.js-core');
for (const f of await readdir(coreDir)) {
  if (f.endsWith('.js') || f.endsWith('.wasm')) {
    await copyFile(path.join(coreDir, f), path.join(outDir, f));
  }
}

const lang = path.join(outDir, 'eng.traineddata.gz');
if (!existsSync(lang)) {
  console.log('downloading eng.traineddata.gz (~11 MB, one-time)…');
  const urls = [
    'https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz',
    'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0/eng.traineddata.gz',
  ];
  let lastErr;
  let downloaded = false;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(lang, Buffer.from(await res.arrayBuffer()));
      downloaded = true;
      break;
    } catch (err) {
      console.warn(`traineddata download failed from ${url}: ${err.message}`);
      lastErr = err;
    }
  }
  if (!downloaded) {
    throw new Error(`traineddata download failed from all mirrors: ${lastErr.message}`);
  }
}
console.log('tesseract assets ready in public/tesseract/');
