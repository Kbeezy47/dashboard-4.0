import { DashboardData, MiningStats, WalletBalance, PoolBalance, PriceData, Timeframe } from '../types';

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
const DEFAULT_THRESHOLD = 1;

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

// The pool tracks PRL to 6 decimal places.
function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

interface DerivedSplit {
  confirmed: number;
  unconfirmed: number;
  total: number;
  threshold: number;
}

const EMPTY_POOL_BALANCE: PoolBalance = {
  confirmed: 0,
  unconfirmed: 0,
  pending: 0,
  total: 0,
  threshold: DEFAULT_THRESHOLD,
  thresholdProgressPct: 0,
  source: 'unavailable',
  available: false,
  lastUpdated: 'Never',
};

/**
 * Normalizes the explicit pool balance contract. The server already returns
 * exact confirmed/unconfirmed numbers, so they are passed through untouched.
 * Legacy payloads (raw bot strings only) get a derived split as a fallback.
 */
function normalizePoolBalancePayload(
  pb: PoolBalance | undefined,
  derived: DerivedSplit,
  lastUpdated: string,
): PoolBalance {
  if (pb && Number.isFinite(pb.confirmed) && Number.isFinite(pb.unconfirmed)) {
    const confirmed = round6(pb.confirmed);
    const unconfirmed = round6(pb.unconfirmed);
    const threshold = Number.isFinite(pb.threshold) && pb.threshold > 0
      ? pb.threshold
      : DEFAULT_THRESHOLD;

    return {
      confirmed,
      unconfirmed,
      pending: Number.isFinite(pb.pending) ? round6(pb.pending) : unconfirmed,
      total: Number.isFinite(pb.total) ? round6(pb.total) : round6(confirmed + unconfirmed),
      threshold,
      // Only confirmed PRL counts toward the payout threshold.
      thresholdProgressPct: Number.isFinite(pb.thresholdProgressPct)
        ? pb.thresholdProgressPct
        : round6((confirmed / threshold) * 100),
      source: pb.source ?? 'kryptex-pool',
      available: pb.available ?? true,
      lastUpdated: pb.lastUpdated ?? lastUpdated,
      error: pb.error,
    };
  }

  const { confirmed, unconfirmed, total, threshold } = derived;
  const safeThreshold = threshold > 0 ? threshold : DEFAULT_THRESHOLD;
  const hasData = total > 0 || confirmed > 0 || unconfirmed > 0;

  return {
    ...EMPTY_POOL_BALANCE,
    confirmed: round6(confirmed),
    unconfirmed: round6(unconfirmed),
    pending: round6(unconfirmed),
    total: round6(total || confirmed + unconfirmed),
    threshold: safeThreshold,
    thresholdProgressPct: round6((confirmed / safeThreshold) * 100),
    source: hasData ? 'telegram-estimate' : 'unavailable',
    available: hasData,
    lastUpdated,
  };
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

  // Prefer the server's explicit split strings; only derive for legacy payloads.
  const confirmed = toNumber(payload.balanceConfirmed) ?? total - total * (percent / 100);
  const unconfirmed = toNumber(payload.balanceUnconfirmed) ?? total * (percent / 100);
  const threshold =
    toNumber(payload.payoutThreshold) ?? toNumber(thresholdMatch?.[1]) ?? DEFAULT_THRESHOLD;

  const lastUpdated = payload.lastUpdated ?? 'Never';
  const poolBalance = normalizePoolBalancePayload(
    payload.poolBalance,
    { confirmed, unconfirmed, total, threshold },
    lastUpdated,
  );

  return {
    workerStatus: payload.workerStatus ?? 'offline',
    currentHashrate: payload.currentHashrate ?? '0 TH/s',
    avgHashrate3H: payload.avgHashrate3H ?? '0 TH/s',
    totalHashrate30m: payload.totalHashrate30m ?? '0 TH/s',
    balance: formatAmount(total),
    balanceCurrency: currency,
    balanceUsd: payload.balanceUsd || usdMatch?.[1] || '0',
    balanceConfirmed: payload.balanceConfirmed ?? confirmed.toFixed(6),
    balanceUnconfirmed: payload.balanceUnconfirmed ?? unconfirmed.toFixed(6),
    unconfirmedPercent: percent,
    payoutThreshold: payload.payoutThreshold || thresholdMatch?.[1] || '0',
    poolBalance,
    profit24h: payload.profit24h ?? '0',
    profit7d: payload.profit7d,
    profit30d: payload.profit30d,
    lastUpdated,
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

// Clean, explicit PRL pool balance contract from /api/pool-balance.
export const fetchPoolBalance = async (): Promise<PoolBalance> => {
  const response = await fetch('/api/pool-balance');
  if (!response.ok) {
    throw new Error('Failed to fetch PRL pool balance');
  }
  const payload: PoolBalance = await response.json();
  return normalizePoolBalancePayload(
    payload,
    { confirmed: 0, unconfirmed: 0, total: 0, threshold: DEFAULT_THRESHOLD },
    payload.lastUpdated ?? 'Never',
  );
};

// The /api/wallet payload, backed by the Pearl Explorer Web API on the server.
export const fetchWalletBalance = async (): Promise<WalletBalance> => {
  const response = await fetch('/api/wallet');
  if (!response.ok) {
    throw new Error('Failed to fetch local wallet balance');
  }
  return response.json();
};

// PRL price history from CoinGecko, proxied through /api/prl-price.
export const fetchPriceData = async (timeframe: Timeframe = '24h'): Promise<PriceData> => {
  const response = await fetch(`/api/prl-price?timeframe=${encodeURIComponent(timeframe)}`);
  if (!response.ok) {
    throw new Error('Failed to fetch PRL price data');
  }
  return response.json();
};
