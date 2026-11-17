export interface SystemMetrics {
  // Box 1: GPU Fan
  gpuFan: number;          // %
  gpuFanRpm: number;       // RPM (0-3200)

  // Box 2: GPU Temp
  gpuTemp: number;         // °C

  // Box 3: GPU Hotspot
  gpuHotspot: number;      // °C

  // Box 4: GPU Memory (Junction Temp)
  gpuMemoryTemp: number;   // °C

  // Box 5: GPU Load
  gpuLoad: number;         // %

  // Box 6: CPU Temp
  cpuTemp: number;         // °C

  // Box 7: CPU Load
  cpuLoad: number;         // %

  // Box 8: Physical Memory
  ramUsedGb: number;       // e.g. 14.8
  ramTotalGb: number;      // e.g. 32.0
  ramPercent: number;      // %

  // System Hardware Metadata
  uptime: string;          // "X days, Y hours, Z minutes"
  uptimeSeconds: number;
  gpuName: string;         // e.g. "NVIDIA GeForce RTX 3080"
  processorName: string;   // e.g. "AMD Ryzen 7 5800X"
  lastUpdated: string;
}

export interface MetricHistoryPoint {
  timestamp: number;
  gpuFan: number;
  gpuTemp: number;
  gpuHotspot: number;
  gpuMemoryTemp: number;
  gpuLoad: number;
  cpuTemp: number;
  cpuLoad: number;
  ramPercent: number;
}

export interface DashboardData {
  metrics: SystemMetrics;
  history: MetricHistoryPoint[];
}

// Normalized PRL pool balance split, in PRL with full 6-decimal precision.
//
// The Kryptex Telegram bot only reports a TOTAL balance plus a rounded integer
// percentage of the payout threshold, so it cannot produce an exact split. The
// pool's own miner stats page does expose exact "Confirmed" and "Pending"
// figures, which is what this contract carries.
export interface PoolBalance {
  confirmed: number;            // Exact confirmed balance, e.g. 0.506946
  unconfirmed: number;          // Exact pending/unconfirmed balance, e.g. 0.312358
  pending: number;              // Alias of `unconfirmed` (the pool calls it "Pending")
  total: number;                // confirmed + unconfirmed, e.g. 0.819304
  threshold: number;            // Payout threshold, e.g. 1.0
  thresholdProgressPct: number; // (confirmed / threshold) * 100, NOT total / threshold
  source: 'kryptex-pool' | 'telegram-estimate' | 'unavailable';
  available: boolean;           // false when neither source produced a split
  lastUpdated: string;          // ISO timestamp of the last successful read
  error?: string;               // Diagnostic message for the last failed read
}

// Mining Stats from KryptexMonitoringBot
export interface MiningStats {
  workerStatus: string;
  currentHashrate: string;
  avgHashrate3H: string;
  totalHashrate30m: string;

  // Wallet balance breakdown (string forms kept for the existing UI)
  balance: string;              // Total balance, e.g. "0.819305"
  balanceCurrency: string;      // Ticker, e.g. "PRL"
  balanceUsd: string;           // Fiat value, e.g. "1.33"
  balanceConfirmed: string;     // Confirmed portion, 6 decimals, e.g. "0.506946"
  balanceUnconfirmed: string;   // Unconfirmed portion, 6 decimals, e.g. "0.312358"
  unconfirmedPercent: number;   // % of the pool balance that is unconfirmed
  payoutThreshold: string;      // Payout threshold, e.g. "1.0"

  // Explicit, numeric balance contract. Always prefer this over deriving a
  // split from the string fields above.
  poolBalance: PoolBalance;

  profit24h: string;
  profit7d?: string;
  profit30d?: string;
  lastUpdated: string;
}

// PRL wallet balance read from the Pearl Explorer Web API.
// This is the on-chain wallet figure, independent of what the mining pool reports.
export interface WalletBalance {
  balance: string;          // Wallet balance, e.g. "1.41"
  currency: string;         // Ticker, e.g. "PRL"
  estimatedUsd?: string;    // Fiat estimate derived from the pool's PRL rate
  available: boolean;       // false when the explorer API could not be reached
  error?: string;           // Diagnostic message for the last failed read
  lastUpdated: string;      // ISO timestamp of the last successful read
  source: string;           // e.g. "Pearl Explorer API"
}

// --- PRL Price Data (CoinGecko) ---

// A single price observation at a point in time.
export interface PricePoint {
  timestamp: number;        // Unix ms timestamp
  price: number;            // Price in USD
  volume?: number;          // Optional 24h volume in USD
}

// Historical price series for the PRL chart.
export interface PriceData {
  prices: PricePoint[];     // Chronological price series
  currentPrice: number;     // Most recent price
  priceChange24h: number;   // Absolute change over the window
  priceChangePercent24h: number; // Percent change over the window
  high24h: number;          // Highest price in the window
  low24h: number;           // Lowest price in the window
  lastUpdated: number;      // Unix ms timestamp of this snapshot
  available: boolean;       // false when the upstream fetch failed
  error?: string;           // Diagnostic message for the last failed fetch
}

// Supported chart timeframes.
export type Timeframe = '1h' | '6h' | '24h' | '7d' | '30d';

// Supported averaging algorithms shown as chart tabs.
export type AverageAlgorithm = 'raw' | 'sma' | 'ema' | 'bb';