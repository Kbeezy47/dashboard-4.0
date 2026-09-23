// Temporary verification of the /api/wallet code path in server.ts.
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

async function refreshWalletBalance(): Promise<string> {
  const bin = await resolvePython();
  const { stdout } = await execFileAsync(bin, [WALLET_SCRIPT], {
    windowsHide: true,
    timeout: WALLET_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });

  const value = parseFloat(stdout.trim());
  if (!Number.isFinite(value)) {
    throw new Error(`Unexpected wallet output: ${stdout.trim() || '<empty>'}`);
  }

  return value.toFixed(2);
}

const balance = await refreshWalletBalance();
console.log('Resolved interpreter:', resolvedPython);
console.log('Wallet balance:', balance, 'PRL');
