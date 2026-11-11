// `npm run verify` (spec 4): layers 1, 2, 4 and 5, printed as the 12 lines.
// No keys needed. Progress goes to stderr; stdout is exactly the 12 lines and a total.
//
//   npm run verify                      # testnet coins
//   npm run verify -- --out verify.txt  # also write the output to a file
//
// Without Rust the Rust layers print SKIP and the live lines still run.
// Env overrides for a local sandbox: see verify/live.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, liveChecks, settings } from './live.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const CI_URL = `${String(PKG.repository?.url ?? PKG.repository).replace(/^git\+/, '').replace(/\.git$/, '')}/actions/workflows/ci.yml`;
const outIdx = process.argv.indexOf('--out');
const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null;

const env = { ...process.env, PATH: [join(homedir(), '.cargo/bin'), process.env.PATH].join(delimiter) };
const log = (msg) => process.stderr.write(`· ${msg}\n`);
const has = (cmd, args) => spawnSync(cmd, args, { env, stdio: 'ignore' }).status === 0;

function run(cmd, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...env, ...extraEnv } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ ok: code === 0, out }));
    child.on('error', (e) => resolve({ ok: false, out: String(e) }));
  });
}

/** The first panic message in cargo test output, for FAIL details. */
function panicOf(out) {
  const lines = out.split('\n');
  const i = lines.findIndex((l) => l.includes('panicked at'));
  if (i < 0) return lines.filter((l) => /error/i.test(l)).slice(0, 3).join(' / ').trim() || 'see `cargo test` output';
  return [lines[i], lines[i + 1]].join(' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

const testOk = (out, name) => new RegExp(`^test ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\.\\.\\. ok$`, 'm').test(out);

// ------------------------------------------------------------------ Rust layers

async function rustLayers() {
  if (!has('cargo', ['--version'])) {
    log('cargo not found: Rust layers skipped');
    return null;
  }
  log('layer 1: cargo test -p cto --lib');
  const unit = await run('cargo', ['test', '-p', 'cto', '--lib']);

  let wasm = null;
  let wasmProblem = null;
  if (has('cargo', ['near', '--version'])) {
    log('building the contract: cargo near build non-reproducible-wasm');
    const b = await run('cargo', ['near', 'build', 'non-reproducible-wasm', '--manifest-path', 'contract/Cargo.toml']);
    if (b.ok) wasm = join(ROOT, 'target/near/cto/cto.wasm');
    else wasmProblem = `cargo near build failed: ${panicOf(b.out)}`;
  } else if (existsSync(join(ROOT, 'res/cto.wasm'))) {
    log('cargo-near not found: testing the committed res/cto.wasm');
    wasm = join(ROOT, 'res/cto.wasm');
  } else {
    wasmProblem = 'cargo-near is not installed and res/cto.wasm is missing: nothing to test in the sandbox';
  }

  let sandbox = { ok: false, out: '' };
  if (wasm) {
    log('layer 2: cargo test -p cto --test sandbox (local NEAR sandbox)');
    sandbox = await run('cargo', ['test', '-p', 'cto', '--test', 'sandbox', '--', '--nocapture'], { CTO_WASM: wasm });
  }
  log('layer 5: cargo run -p cto --example sim -- --check');
  const sim = await run('cargo', ['run', '-q', '-p', 'cto', '--example', 'sim', '--', '--check']);
  return { unit, sandbox, wasmProblem, sim };
}

function unitStatus(unit, names) {
  if (!unit.ok) return { status: 'FAIL', detail: [`cargo test -p cto --lib failed: ${panicOf(unit.out)}`] };
  const missing = names.filter((n) => !testOk(unit.out, n));
  return missing.length ? { status: 'FAIL', detail: missing.map((n) => `unit test ${n} did not pass`) } : { status: 'PASS' };
}

function sandboxStatus(r, steps) {
  if (r.wasmProblem) return { status: 'FAIL', detail: [r.wasmProblem] };
  const done = new Set([...r.sandbox.out.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1])));
  const missing = steps.filter((s) => !done.has(s));
  if (missing.length) return { status: 'FAIL', detail: [`sandbox story stopped before step ${missing[0]}: ${panicOf(r.sandbox.out)}`] };
  if (!r.sandbox.ok) return { status: 'FAIL', detail: [`sandbox story failed after these steps: ${panicOf(r.sandbox.out)}`] };
  return { status: 'PASS' };
}

/** All must pass; a SKIP anywhere means the line is SKIP. */
function both(...parts) {
  const fail = parts.filter((p) => p.status === 'FAIL');
  if (fail.length) return { status: 'FAIL', detail: fail.flatMap((p) => p.detail ?? []) };
  const skip = parts.find((p) => p.status === 'SKIP');
  return skip ?? { status: 'PASS' };
}

// ------------------------------------------------------------------ main

const [rust, live] = await Promise.all([rustLayers(), liveChecks(settings())]);
const noRust = { status: 'SKIP', note: `Rust not installed, see CI: ${CI_URL}` };
const R = (f) => (rust ? f(rust) : noRust);
// The live icon check can only turn the face line into a FAIL.
const iconFail = live.icon.status === 'FAIL' ? live.icon : { status: 'PASS' };

const lines = [
  { line: 'price math: 1,000,000 -> 1,400,000 / 1,150,000 / 250,000', ...R((r) => unitStatus(r.unit, ['price::tests::story_numbers', 'price::tests::split_rounds_down_and_always_adds_up'])) },
  { line: 'face changes in ft_metadata', ...both(R((r) => sandboxStatus(r, [5])), iconFail) },
  { line: 'old CEO paid exactly 1.15x', ...R((r) => sandboxStatus(r, [5])) },
  { line: 'supply falls exactly 0.25x', ...R((r) => sandboxStatus(r, [3, 5])) },
  { line: 'old key rejected on chain (AccessKeyNotFound)', ...R((r) => sandboxStatus(r, [6])) },
  { line: 'new key can only call announce', ...R((r) => sandboxStatus(r, [3, 7])) },
  {
    line: 'price decays after the idle window, floor holds',
    ...R((r) => both(sandboxStatus(r, [9]), unitStatus(r.unit, ['price::tests::decay_boundaries', 'price::tests::floor_after_thirty_days', 'price::tests::price_never_rises_while_idle_and_never_goes_below_floor']))),
  },
  live.keysMain,
  live.keysDemo,
  live.code,
  live.supply,
  { line: 'simulation follows the contract math', ...R((r) => (r.sim.ok ? { status: 'PASS' } : { status: 'FAIL', detail: [r.sim.out.trim().split('\n').slice(-3).join(' / ')] })) },
];

const count = (s) => lines.filter((l) => l.status === s).length;
const [passed, failed, skipped] = [count('PASS'), count('FAIL'), count('SKIP')];
const total = [failed && `${failed} failed`, `${passed} passed`, skipped && `${skipped} skipped`].filter(Boolean).join(' · ') + ' · no keys needed';
const output = [...lines.map(format), total].join('\n');
console.log(output);

if (outFile) {
  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  writeFileSync(outFile, `$ npm run verify  # commit ${commit || 'unknown'} · ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}\n${output}\n`);
  log(`wrote ${outFile}`);
}
process.exit(failed ? 1 : 0);
