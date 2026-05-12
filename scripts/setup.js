#!/usr/bin/env node
/**
 * Cross-platform bootstrap + launcher for the Photo Culler app.
 *
 *   $ npm start
 *
 * What it does, in order:
 *   1. Verifies Node, npm, and Python meet minimum versions.
 *   2. Installs any missing packages — root, frontend, and the Python venv
 *      for the backend.
 *   3. Spawns both servers via `concurrently`, with platform-aware
 *      invocation of the backend (arch -arm64 prefix on Apple Silicon,
 *      `venv\Scripts\` on Windows, `venv/bin/` on Linux/macOS).
 *
 * Pass `--check` to run only the version + dependency checks (no launch).
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const IS_WINDOWS = process.platform === 'win32';
const IS_MAC_ARM64 = process.platform === 'darwin' && process.arch === 'arm64';
const CHECK_ONLY = process.argv.includes('--check');

const MIN = {
  node: { major: 20 },        // Vite 8 requires Node 20+
  npm:  { major: 9 },
  python: { major: 3, minor: 10 },
};

// --- terminal styling (no deps) -------------------------------------------
const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
const ok    = (s) => console.log(c('32', '  ✓ ') + s);
const warn  = (s) => console.log(c('33', '  ⚠ ') + s);
const fail  = (s) => console.log(c('31', '  ✗ ') + s);
const step  = (s) => console.log(c('36', '\n› ') + c('1', s));
const banner = (s) => console.log('\n' + c('1;36', s));

// --- helpers --------------------------------------------------------------
function tryExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function parseVersion(str) {
  const m = str && str.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +(m[3] ?? 0), full: `${m[1]}.${m[2]}.${m[3] ?? 0}` };
}

function meetsMin(v, min) {
  if (!v) return false;
  if (v.major !== min.major) return v.major > min.major;
  if (min.minor !== undefined) return v.minor >= min.minor;
  return true;
}

function streamRun(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit', shell: IS_WINDOWS });
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
    p.on('error', reject);
  });
}

function venvBin(name) {
  if (IS_WINDOWS) return join(ROOT, 'backend', 'venv', 'Scripts', name + '.exe');
  return join(ROOT, 'backend', 'venv', 'bin', name);
}

function findPython() {
  for (const bin of ['python3', 'python']) {
    const out = tryExec(`${bin} --version`);
    const v = parseVersion(out);
    if (v) return { bin, ...v };
  }
  return null;
}

// --- version checks -------------------------------------------------------
banner('Photo Culler — environment check');

step('Versions');

const nodeV = parseVersion(process.versions.node);
if (!meetsMin(nodeV, MIN.node)) {
  fail(`Node ${nodeV.full} — need >= ${MIN.node.major}.0.0`);
  fail('Install from https://nodejs.org/ and re-run "npm start"');
  process.exit(1);
}
ok(`Node ${nodeV.full}`);

const npmV = parseVersion(tryExec('npm --version'));
if (!npmV) {
  fail('npm not on PATH');
  process.exit(1);
}
if (!meetsMin(npmV, MIN.npm)) {
  fail(`npm ${npmV.full} — need >= ${MIN.npm.major}.0.0  (run "npm install -g npm")`);
  process.exit(1);
}
ok(`npm ${npmV.full}`);

const py = findPython();
if (!py) {
  fail(`Python not found. Install Python ${MIN.python.major}.${MIN.python.minor}+ from https://www.python.org/downloads/`);
  process.exit(1);
}
if (!meetsMin(py, MIN.python)) {
  fail(`Python ${py.full} — need >= ${MIN.python.major}.${MIN.python.minor}`);
  process.exit(1);
}
ok(`Python ${py.full} (${py.bin})`);

if (IS_MAC_ARM64) ok('Detected macOS arm64 — will prefix the venv Python with `arch -arm64`');
if (IS_WINDOWS)   ok('Detected Windows — will use venv\\Scripts\\ paths');

// --- dependency install ---------------------------------------------------
step('Dependencies');

async function ensureRoot() {
  if (existsSync(join(ROOT, 'node_modules', '.package-lock.json'))) {
    ok('Root packages already installed');
    return;
  }
  console.log('  Installing root packages (concurrently)…');
  await streamRun('npm', ['install'], ROOT);
  ok('Root packages installed');
}

async function ensureFrontend() {
  if (existsSync(join(ROOT, 'frontend', 'node_modules', '.package-lock.json'))) {
    ok('Frontend packages already installed');
    return;
  }
  console.log('  Installing frontend packages…');
  await streamRun('npm', ['install'], join(ROOT, 'frontend'));
  ok('Frontend packages installed');
}

async function ensureBackend() {
  if (!existsSync(venvBin('python'))) {
    console.log('  Creating Python virtualenv…');
    await streamRun(py.bin, ['-m', 'venv', 'venv'], join(ROOT, 'backend'));
  }
  // Re-install when requirements.txt changes. The hash marker lives inside
  // the venv so it auto-invalidates if the venv itself is wiped.
  const reqPath = join(ROOT, 'backend', 'requirements.txt');
  const markerPath = join(ROOT, 'backend', 'venv', '.requirements-hash');
  const currentHash = createHash('sha256').update(readFileSync(reqPath)).digest('hex');
  const cachedHash = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : '';
  const needInstall =
    cachedHash !== currentHash ||
    !existsSync(venvBin('uvicorn')) ||
    !existsSync(venvBin('pytest'));
  if (!needInstall) {
    ok('Backend packages already installed');
    return;
  }
  console.log('  Installing backend packages…');
  const pip = venvBin('pip');
  if (IS_MAC_ARM64) {
    await streamRun('arch', ['-arm64', pip, 'install', '-r', 'requirements.txt'], join(ROOT, 'backend'));
  } else {
    await streamRun(pip, ['install', '-r', 'requirements.txt'], join(ROOT, 'backend'));
  }
  writeFileSync(markerPath, currentHash);
  ok('Backend packages installed');
}

await ensureRoot();
await ensureFrontend();
await ensureBackend();

if (CHECK_ONLY) {
  banner('All checks passed. Run `npm start` to launch the servers.');
  process.exit(0);
}

// --- launch ---------------------------------------------------------------
step('Starting servers');

const pythonBin = venvBin('python');
// Bind to 0.0.0.0 so other devices on the LAN (phones, tablets) can hit
// both servers. CORS is already wide-open in main.py for local dev.
const backendCommand = IS_MAC_ARM64
  ? `arch -arm64 ${quote(pythonBin)} -m uvicorn main:app --reload --host 0.0.0.0 --port 8000`
  : `${quote(pythonBin)} -m uvicorn main:app --reload --host 0.0.0.0 --port 8000`;
// `-- --host` forwards the flag to Vite past npm's arg parser; Vite then
// binds to 0.0.0.0 and prints both Local and Network URLs at startup.
const frontendCommand = 'npm run dev -- --host';

function quote(p) {
  // Wrap in quotes if the path contains spaces; double-quotes work on
  // both bash and cmd.
  return /\s/.test(p) ? `"${p}"` : p;
}

console.log(`  backend  → ${backendCommand}`);
console.log(`  frontend → ${frontendCommand}`);
console.log('');

// concurrently exposes a programmatic API with per-command `cwd`, which
// sidesteps every shell-dialect difference (cmd's `cd /d`, PowerShell's
// `Set-Location`, bash's `cd`). Each child runs in the right directory
// without us ever spawning a shell.
const { default: concurrently } = await import('concurrently');
const { result } = concurrently(
  [
    { name: 'backend',  command: backendCommand,  cwd: join(ROOT, 'backend')  },
    { name: 'frontend', command: frontendCommand, cwd: join(ROOT, 'frontend') },
  ],
  {
    prefix: 'name',
    prefixColors: ['blue', 'magenta'],
    killOthersOn: ['failure', 'success'],
    restartTries: 0,
  },
);

try {
  await result;
} catch (e) {
  // Either child exited with a non-zero code or the user hit Ctrl+C.
  // `result` rejects with the array of close events in both cases; we just
  // surface a non-zero exit so CI / shell-loops notice.
  process.exit(1);
}
