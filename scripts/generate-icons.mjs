import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'icons');
await mkdir(outDir, { recursive: true });

const jobs = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
];
for (const [src, out, size] of jobs) {
  await sharp(path.join(root, 'assets', src)).resize(size, size).png().toFile(path.join(outDir, out));
  console.log(out);
}
