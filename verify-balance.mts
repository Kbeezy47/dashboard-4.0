import fs from 'fs';
import assert from 'assert/strict';
import { parseTelegramBalance } from './services/telegramClient';
import {
  parsePoolPage,
  fetchKryptexPoolSplit,
  normalizePoolBalance,
} from './services/poolBalance';

const WALLET = 'prl1pydcxqf6kwvzgrqx4gz5nt0mverm9hfkhkdj24k3k5ccjegaaz2mspxjy8f';

const SAMPLE = `Wallet: ${WALLET}
Pool: prl.kryptex.network

Balance: 0.819305 PRL (1.33 USD).
Balance / threshold: 0.819305 / 1.0 PRL (49%).
Profit for the last 24 hours / 7 days / 30 days: 0.130563 / 5.543824 / 12.836587 PRL.`;

console.log('--- Telegram fallback parser ---');
const tg = parseTelegramBalance(SAMPLE);
console.log(tg);
assert.equal(tg?.total, 0.819305, 'total from Balance line');
assert.equal(tg?.threshold, 1.0, 'threshold');
assert.equal(tg?.thresholdPct, 49, 'rounded threshold pct');
assert.equal(tg?.confirmed, 0.49, 'confirmed = threshold * pct');
assert.equal(tg?.unconfirmed, 0.329305, 'unconfirmed = total - confirmed');
assert.equal(tg?.usd, '1.33', 'USD string preserved');
assert.equal(tg?.profit24h, '0.130563 PRL');
assert.equal(tg?.profit7d, '5.543824 PRL');
assert.equal(tg?.profit30d, '12.836587 PRL');
assert.notEqual(tg?.unconfirmed, tg?.total, 'total must NOT be dumped into unconfirmed');

console.log('\n--- Telegram estimate normalized contract ---');
const est = normalizePoolBalance(
  { confirmed: tg!.confirmed!, unconfirmed: tg!.unconfirmed!, total: tg!.total! },
  tg!.threshold!,
  'telegram-estimate',
);
console.log(est);
assert.equal(est.total, 0.819305);
assert.equal(est.thresholdProgressPct, 49);
assert.equal(est.source, 'telegram-estimate');

console.log('\n--- Kryptex page scraper (saved HTML) ---');
const html = fs.readFileSync('kryptex-page.html', 'utf8');
const split = parsePoolPage(html);
console.log(split);
assert.equal(split?.confirmed, 0.506946, 'exact confirmed (6 decimals)');
assert.equal(split?.unconfirmed, 0.315888, 'exact pending (6 decimals)');

const exact = normalizePoolBalance(split, 1.0, 'kryptex-pool');
console.log(exact);
assert.equal(exact.confirmed, 0.506946);
assert.equal(exact.unconfirmed, 0.315888);
assert.equal(exact.pending, 0.315888);
assert.equal(exact.total, 0.822834);
assert.equal(exact.threshold, 1.0);
assert.equal(exact.thresholdProgressPct, 50.6946, 'confirmed/threshold, NOT total/threshold');
assert.equal(exact.source, 'kryptex-pool');

console.log('\n--- Live Kryptex pool fetch ---');
const live = await fetchKryptexPoolSplit(WALLET);
console.log(live);
assert.ok(live, 'live pool split should be available');
assert.ok(live!.confirmed > 0 && live!.unconfirmed > 0, 'both halves must be present');
assert.ok(Math.abs(live!.total - (live!.confirmed + live!.unconfirmed)) < 1e-5);

console.log('\nALL CHECKS PASSED');
