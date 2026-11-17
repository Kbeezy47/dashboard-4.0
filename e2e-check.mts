import { spawn } from 'child_process';

const child = spawn('bun', ['server.ts'], {
  env: {
    ...process.env,
    TELEGRAM_API_ID: '1',
    TELEGRAM_API_HASH: 'dummy-hash-for-e2e',
    TELEGRAM_SESSION: '',
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
await wait(14000);

try {
  const pbRes = await fetch('http://127.0.0.1:3000/api/pool-balance');
  const pb = await pbRes.json();
  console.log('\n=== /api/pool-balance ===');
  console.log(JSON.stringify(pb, null, 2));

  const minerRes = await fetch('http://127.0.0.1:3000/api/miner');
  const miner = await minerRes.json();
  console.log('\n=== /api/miner (balance fields) ===');
  console.log(JSON.stringify({
    balance: miner.balance,
    balanceConfirmed: miner.balanceConfirmed,
    balanceUnconfirmed: miner.balanceUnconfirmed,
    unconfirmedPercent: miner.unconfirmedPercent,
    payoutThreshold: miner.payoutThreshold,
    poolBalance: miner.poolBalance,
  }, null, 2));

  if (pb.source !== 'kryptex-pool' || !pb.available) throw new Error('pool source not exact');
  if (pb.confirmed <= 0 || pb.unconfirmed <= 0) throw new Error('missing split halves');
  if (pb.unconfirmed === pb.total) throw new Error('total dumped into unconfirmed');
  if (Math.abs(pb.total - (pb.confirmed + pb.unconfirmed)) > 1e-6) throw new Error('total mismatch');
  if (Math.abs(pb.thresholdProgressPct - (pb.confirmed / pb.threshold) * 100) > 1e-4) {
    throw new Error('thresholdProgressPct wrong');
  }
  if (miner.balanceUnconfirmed === miner.balance) throw new Error('miner unconfirmed == total');
  console.log('\nE2E CHECKS PASSED');
} catch (err) {
  console.error('E2E FAILED:', err);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await wait(500);
  child.kill('SIGKILL');
}
