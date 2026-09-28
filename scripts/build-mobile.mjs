// KUBO KARTS v3.7 — static build for the APK  (npm run build:mobile)
// API routes (src/app/api) need a Node server and cannot be in a static
// export, so they are moved aside during the build and ALWAYS restored.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = path.join(root, 'src', 'app', 'api');
const parked = path.join(root, '.mobile-build-parked-api');

// a previous build was killed half-way → put the API back first
if (fs.existsSync(parked) && !fs.existsSync(api)) fs.renameSync(parked, api);

let moved = false;
try {
  if (fs.existsSync(api)) { fs.renameSync(api, parked); moved = true; }
  fs.rmSync(path.join(root, 'out'), { recursive: true, force: true });
  execSync('npx next build', { cwd: root, stdio: 'inherit', env: { ...process.env, KUBO_TARGET: 'mobile' } });
  if (!fs.existsSync(path.join(root, 'out', 'index.html'))) throw new Error('out/index.html missing — static export failed');
  console.log('\n✅ mobile build ready in ./out');
} finally {
  if (moved) fs.renameSync(parked, api);
}
