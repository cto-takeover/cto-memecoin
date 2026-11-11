// Writes web/public/build-info.json before the web build, so Receipts can compare
// the deployed code hash with the committed res/cto.wasm. No wasm, no file.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeHashOf } from '../verify/live.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasm = join(ROOT, 'res/cto.wasm');
const out = join(ROOT, 'web/public/build-info.json');
if (!existsSync(wasm)) {
  rmSync(out, { force: true });
  console.log('build-info: res/cto.wasm not committed yet, skipped');
} else {
  let commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  try {
    commit ||= execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {}
  const info = { codeHash: codeHashOf(wasm), wasm: 'res/cto.wasm', commit: commit || null };
  writeFileSync(out, JSON.stringify(info, null, 2) + '\n');
  console.log(`build-info: ${info.codeHash}`);
}
