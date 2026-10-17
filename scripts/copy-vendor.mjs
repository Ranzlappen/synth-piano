// Copies third-party runtime assets that must stay as separate, replaceable files
// (Verovio is LGPL-3.0 and is loaded dynamically by the engraving worker).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  {
    from: join(root, 'node_modules', 'verovio', 'dist', 'verovio-toolkit-wasm.js'),
    to: join(root, 'src', 'renderer', 'public', 'vendor', 'verovio', 'verovio-toolkit-wasm.js'),
  },
];

for (const { from, to } of targets) {
  if (!existsSync(from)) {
    console.warn(`[copy-vendor] missing ${from} (run npm install)`);
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`[copy-vendor] ${to.replace(root, '.')}`);
}
