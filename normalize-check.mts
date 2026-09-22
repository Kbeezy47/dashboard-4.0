// Temporary check of the frontend normalization against real payloads.
function toNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const match = String(raw).match(/-?[\d.,]+/);
  if (!match) return null;
  const value = parseFloat(match[0].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function toPercent(raw) {
  if (raw === undefined || raw === null) return null;
  const match = String(raw).match(/(-?[\d.,]+)\s*%/);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function formatAmount(value) {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(8).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function normalizeMiningStats(payload) {
  const rawBalance = payload.balance ?? '';
  const total = toNumber(rawBalance) ?? 0;

  const currencyMatch = rawBalance.match(/[\d.,]+\s*([A-Za-z]+)/);
  const usdMatch = rawBalance.match(/\(\s*([\d.,]+)\s*USD/i);
  const thresholdMatch = payload.pending?.match(/\/\s*([\d.,]+)/);

  const currency = payload.balanceCurrency || currencyMatch?.[1] || 'PRL';

  const rawPercent = payload.unconfirmedPercent;
  const percent = Number.isFinite(rawPercent)
    ? Math.min(100, Math.max(0, rawPercent))
    : (toPercent(payload.pending) ?? 0);

  const unconfirmed = total * (percent / 100);
  const confirmed = total - unconfirmed;

  return {
    workerStatus: payload.workerStatus ?? 'offline',
    currentHashrate: payload.currentHashrate ?? '0 TH/s',
    avgHashrate3H: payload.avgHashrate3H ?? '0 TH/s',
    totalHashrate30m: payload.totalHashrate30m ?? '0 TH/s',
    balance: formatAmount(total),
    balanceCurrency: currency,
    balanceUsd: payload.balanceUsd || usdMatch?.[1] || '0',
    balanceConfirmed: payload.balanceConfirmed ?? formatAmount(confirmed),
    balanceUnconfirmed: payload.balanceUnconfirmed ?? formatAmount(unconfirmed),
    unconfirmedPercent: percent,
    payoutThreshold: payload.payoutThreshold || thresholdMatch?.[1] || '0',
    profit24h: payload.profit24h ?? '0',
    lastUpdated: payload.lastUpdated ?? 'Never',
  };
}

// 1. LIVE payload from the currently running (stale) server
const live = {
  workerStatus: 'active',
  currentHashrate: '105.08 TH/s',
  avgHashrate3H: '103.5 TH/s',
  totalHashrate30m: '120.1 TH/s',
  balance: '0.994521 PRL (1.0 USD)',
  pending: '0.994521 / 1.0 PRL (74%)',
  profit24h: '2.294583 PRL',
  lastUpdated: '5:47:02 PM',
};

// 2. New structured payload from the updated server
const structured = {
  workerStatus: 'active',
  currentHashrate: '105.08 TH/s',
  avgHashrate3H: '103.5 TH/s',
  totalHashrate30m: '120.1 TH/s',
  balance: '0.938014',
  balanceCurrency: 'PRL',
  balanceUsd: '0.91',
  balanceConfirmed: '0.24388364',
  balanceUnconfirmed: '0.69413036',
  unconfirmedPercent: 74,
  payoutThreshold: '1.0',
  profit24h: '2.294583 PRL',
  lastUpdated: '5:47:02 PM',
};

// 3. Empty / initial payload
const empty = {};

console.log('--- live (legacy) payload ---');
const a = normalizeMiningStats(live);
console.log(a);
console.log('expected unconfirmed 0.73594554 ->', a.balanceUnconfirmed === '0.73594554');
console.log('expected confirmed   0.25857546 ->', a.balanceConfirmed === '0.25857546');

console.log('--- structured payload ---');
const b = normalizeMiningStats(structured);
console.log(b);
console.log('passthrough unconfirmed ->', b.balanceUnconfirmed === '0.69413036');
console.log('passthrough confirmed   ->', b.balanceConfirmed === '0.24388364');

console.log('--- empty payload ---');
console.log(normalizeMiningStats(empty));
