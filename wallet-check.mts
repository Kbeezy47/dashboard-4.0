// Temporary verification of the services/get_balance.py pool split fetcher.
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

const WALLET_SCRIPT = path.join(process.cwd(), 'services', 'get_balance.py');
const WALLET_TIMEOUT_MS = 30_000;

const PYTHON_CANDIDATES = [
  ...(process.env.PYTHON_BIN ? [process.env.PYTHON_BIN] : []),
  'python',
  'python3',
  'py',
];

let resolvedPython: string | null = null;

async function resolvePython(): Promise<string> {
  if (resolvedPython) return resolvedPython;

  for (const bin of PYTHON_CANDIDATES) {
    try {
      await execFileAsync(bin, ['--version'], { windowsHide: true });
    } catch {
      continue;
    }
    resolvedPython = bin;
    return bin;
  }

  throw new Error('No Python interpreter found. Set PYTHON_BIN to your python executable.');
}

async function refreshPoolBalance(): Promise<Record<string, unknown>> {
  const bin = await resolvePython();
  const { stdout } = await execFileAsync(bin, [WALLET_SCRIPT], {
    windowsHide: true,
    timeout: WALLET_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });

  try {
    return JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    throw new Error(`Unexpected wallet output: ${stdout.trim() || '<empty>'}`);
  }
}

const balance = await refreshPoolBalance();
console.log('Resolved interpreter:', resolvedPython);
console.log('Pool balance:', JSON.stringify(balance, null, 2));
