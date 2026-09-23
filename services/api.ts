import { DashboardData, MiningStats, WalletBalance } from '../types';

export const fetchDashboardData = async (): Promise<DashboardData> => {
  const response = await fetch('/api/dashboard');
  if (!response.ok) {
    throw new Error('Failed to fetch hardware dashboard metrics');
  }
  return response.json();
};

// The /api/miner payload. Older server builds returned the raw bot strings
// ("0.994521 PRL (1.0 USD)" and "0.994521 / 1.0 PRL (74%)") instead of the
// structured balance fields, so both shapes are supported here.
type MinerPayload = Partial<MiningStats> & { pending?: string };

const DEFAULT_CURRENCY = 'PRL';

// Pulls the first number out of a raw bot string.
function toNumber(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const match = String(raw).match(/-?[\d.,]+/);
  if (!match) return null;
  const value = parseFloat(match[0].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

// Pulls a percentage out of a raw bot string, e.g. "(74%)" -> 74.
function toPercent(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const match = String(raw).match(/(-?[\d.,]+)\s*%/);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

// Up to 8 decimals, trailing zeros trimmed.
function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value
    .toFixed(8)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

// Guarantees the UI always receives a fully populated MiningStats object,
// deriving the confirmed/unconfirmed split when the server did not supply it.
function normalizeMiningStats(payload: MinerPayload): MiningStats {
  const rawBalance = payload.balance ?? '';
  const total = toNumber(rawBalance) ?? 0;

  // "0.994521 PRL (1.0 USD)" -> currency "PRL", usd "1.0"
  const currencyMatch = rawBalance.match(/[\d.,]+\s*([A-Za-z]+)/);
  const usdMatch = rawBalance.match(/\(\s*([\d.,]+)\s*USD/i);
  const thresholdMatch = payload.pending?.match(/\/\s*([\d.,]+)/);

  const currency = payload.balanceCurrency || currencyMatch?.[1] || DEFAULT_CURRENCY;

  // The percentage reported alongside the payout progress is the
  // unconfirmed share of the balance.
  const rawPercent = payload.unconfirmedPercent;
  const percent = Number.isFinite(rawPercent)
    ? Math.min(100, Math.max(0, rawPercent as number))
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

export const fetchMinerData = async (): Promise<MiningStats> => {
  const response = await fetch('/api/miner');
  if (!response.ok) {
    throw new Error('Failed to fetch mining stats');
  }
  const payload: MinerPayload = await response.json();
  return normalizeMiningStats(payload);
};

// The /api/wallet payload, backed by services/get_balance.py (prlctl).
export const fetchWalletBalance = async (): Promise<WalletBalance> => {
  const response = await fetch('/api/wallet');
  if (!response.ok) {
    throw new Error('Failed to fetch local wallet balance');
  }
  return response.json();
};
