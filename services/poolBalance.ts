import { PoolBalance } from '../types';

// --- Kryptex PRL pool balance -------------------------------------------------
//
// The Kryptex Telegram bot only reports a TOTAL balance plus a rounded integer
// percentage of the payout threshold, so it cannot produce an exact confirmed /
// unconfirmed split. The pool's own miner stats page does expose exact
// "Confirmed" and "Pending" figures (6 decimals in the rendered HTML, full float
// precision in the embedded Nuxt payload). That page is the primary source.
//
// There is currently no public JSON API for miner stats (the /api/v1/... URLs
// below all return 404), but they are tried first so the code starts using a
// real API automatically if Kryptex ever exposes one.

export const POOL_TIMEOUT_MS = 15_000;
export const DEFAULT_PAYOUT_THRESHOLD = 1.0;

const POOL_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface PoolSplit {
  confirmed: number;
  unconfirmed: number;
  total: number;
  reachedPct?: number;
}

/** Locks a PRL amount to the pool's 6-decimal precision. */
export function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function toFiniteNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const value = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function pickNumber(obj: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = toFiniteNumber(obj?.[key]);
    if (value !== null) return value;
  }
  return null;
}

// Maps the pool's `confirmed` / `balance` and `unconfirmed` / `pending` fields.
// `balance` is only accepted as a confirmed alias when the object does not also
// carry an explicit total that it equals (otherwise it is the total balance).
function extractSplitFromJson(payload: any): PoolSplit | null {
  const objects = [payload, payload?.data, payload?.stats, payload?.miner, payload?.result, payload?.balance];
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;

    const total = pickNumber(obj, ['total', 'total_balance']);
    let confirmed = pickNumber(obj, ['confirmed', 'confirmed_balance']);
    if (confirmed === null) {
      const balanceAlias = pickNumber(obj, ['balance']);
      if (balanceAlias !== null && !(total !== null && Math.abs(balanceAlias - total) < 1e-9)) {
        confirmed = balanceAlias;
      }
    }
    const unconfirmed = pickNumber(obj, ['unconfirmed', 'pending', 'unconfirmed_balance', 'pending_balance']);
    if (confirmed === null || unconfirmed === null) continue;

    return {
      confirmed: round6(confirmed),
      unconfirmed: round6(unconfirmed),
      total: round6(total ?? confirmed + unconfirmed),
    };
  }
  return null;
}

// Rendered HTML: "Confirmed ... 0.506946 <span>PRL</span>" and
//                "Pending   ... 0.315888 <span>PRL</span>".
function labelAmount(html: string, label: string): number | null {
  const re = new RegExp(
    `${label}[\\s\\S]{0,2000}?([\\d]+\\.[\\d]+)\\s*<span[^>]*>\\s*PRL\\s*<\\/span>`,
    'i',
  );
  return toFiniteNumber(html.match(re)?.[1]);
}

// Nuxt devalue payload: the balance object is followed by the flattened values
// for total, unconfirmed and reached_pct; the confirmed float sits just before
// the object. e.g.
//   ...,0.5069462693829542,{"total":148,"unconfirmed":149,"confirmed":146,
//   "threshold":37,"reached_pct":150,...},0.8228343607296275,
//   0.31588809134667317,51,...
const NUXT_BALANCE_RE =
  /([\d]+\.[\d]+)\s*,\s*\{"total":\d+,"unconfirmed":\d+,"confirmed":\d+,"threshold":\d+,"reached_pct":\d+[^}]*\}\s*,\s*([\d]+\.[\d]+)\s*,\s*([\d]+\.[\d]+)\s*,\s*([\d]+)/;

export function parsePoolPage(html: string): PoolSplit | null {
  // 1. Rendered HTML — already rounded to exactly 6 decimals by the pool UI.
  const confirmed = labelAmount(html, 'Confirmed');
  const pending = labelAmount(html, 'Pending');
  if (confirmed !== null && pending !== null) {
    return {
      confirmed: round6(confirmed),
      unconfirmed: round6(pending),
      total: round6(confirmed + pending),
    };
  }

  // 2. Embedded Nuxt state — full float precision, used if the markup changes.
  const nuxt = html.match(NUXT_BALANCE_RE);
  if (nuxt) {
    const confirmedFull = toFiniteNumber(nuxt[1]);
    const totalFull = toFiniteNumber(nuxt[2]);
    const unconfirmedFull = toFiniteNumber(nuxt[3]);
    const reachedPct = toFiniteNumber(nuxt[4]);
    if (confirmedFull !== null && unconfirmedFull !== null) {
      return {
        confirmed: round6(confirmedFull),
        unconfirmed: round6(unconfirmedFull),
        total: round6(totalFull ?? confirmedFull + unconfirmedFull),
        reachedPct: reachedPct ?? undefined,
      };
    }
  }

  return null;
}

function jsonApiUrls(wallet: string): string[] {
  return [
    `https://pool.kryptex.com/prl/api/v1/miner/stats/${wallet}`,
    `https://pool.kryptex.com/api/v1/miner/stats/prl/${wallet}`,
  ];
}

function pageUrls(wallet: string): string[] {
  return [
    `https://pool.kryptex.com/en/prl/miner/stats/${wallet}`,
    `https://pool.kryptex.com/prl/miner/stats/${wallet}`,
  ];
}

/**
 * Fetches the exact confirmed / unconfirmed split from the Kryptex pool.
 * Returns null when every strategy fails so the caller can fall back to the
 * Telegram estimate instead of dumping the total into "unconfirmed".
 */
export async function fetchKryptexPoolSplit(wallet: string): Promise<PoolSplit | null> {
  const failures: string[] = [];

  // 1. Direct pool API (preferred when available).
  for (const url of jsonApiUrls(wallet)) {
    try {
      const res = await fetch(url, {
        headers: { ...POOL_HEADERS, Accept: 'application/json' },
        signal: AbortSignal.timeout(POOL_TIMEOUT_MS),
      });
      if (!res.ok) {
        failures.push(`${url} -> HTTP ${res.status}`);
        continue;
      }
      const split = extractSplitFromJson(await res.json());
      if (split) return split;
      failures.push(`${url} -> no confirmed/unconfirmed fields`);
    } catch (err) {
      failures.push(`${url} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Server-rendered miner stats page (current working source).
  for (const url of pageUrls(wallet)) {
    try {
      const res = await fetch(url, {
        headers: POOL_HEADERS,
        signal: AbortSignal.timeout(POOL_TIMEOUT_MS),
      });
      if (!res.ok) {
        failures.push(`${url} -> HTTP ${res.status}`);
        continue;
      }
      const split = parsePoolPage(await res.text());
      if (split) return split;
      failures.push(`${url} -> no balance split in page`);
    } catch (err) {
      failures.push(`${url} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.warn(`[pool] exact split unavailable: ${failures.join('; ')}`);
  return null;
}

/** Builds the clean, explicit balance contract consumed by the dashboard. */
export function normalizePoolBalance(
  split: PoolSplit | null,
  threshold: number,
  source: 'kryptex-pool' | 'telegram-estimate' | 'unavailable',
  lastUpdated: string = new Date().toISOString(),
  error?: string,
): PoolBalance {
  const safeThreshold =
    Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_PAYOUT_THRESHOLD;

  if (!split) {
    return {
      confirmed: 0,
      unconfirmed: 0,
      pending: 0,
      total: 0,
      threshold: safeThreshold,
      thresholdProgressPct: 0,
      source: 'unavailable',
      available: false,
      lastUpdated,
      error,
    };
  }

  const confirmed = round6(split.confirmed);
  const unconfirmed = round6(split.unconfirmed);

  return {
    confirmed,
    unconfirmed,
    pending: unconfirmed,
    total: round6(confirmed + unconfirmed),
    threshold: safeThreshold,
    // Only confirmed PRL counts toward the payout threshold.
    thresholdProgressPct: round6((confirmed / safeThreshold) * 100),
    source,
    available: true,
    lastUpdated,
    error,
  };
}
