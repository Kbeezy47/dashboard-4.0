import express, { Request, Response } from 'express';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createServer as createViteServer } from 'vite';
import si from 'systeminformation';
import { initTelegram, client } from "./services/telegramClient";
import { NewMessage } from "telegram/events";
import { MiningStats, WalletBalance, PriceData, PricePoint } from './types';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

// --- PRL Price Data (CoinGecko) ---
const COINGECKO_API = 'https://api.coingecko.com/api/v3';
// CoinGecko ID for Pearl (PRL) — the Pearl Research token, NOT "Perle".
// CoinGecko lists it under the slug "pearl-2" (rank ~134).
// Override with PRL_COINGECKO_ID if it ever changes.
const PRL_COINGECKO_ID = process.env.PRL_COINGECKO_ID || 'pearl-2';
const PRICE_CACHE_MS = 60_000; // Cache price data for 60 seconds

// Cache is keyed by timeframe: a 24h fetch only covers one day, so it cannot
// be sliced to serve a 7d request.
const priceCache = new Map<string, { data: PriceData; time: number }>();

// Returns non-internal IPv4 addresses so the startup log can show the URLs
// other devices on the LAN should use.
function getLanAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const list of Object.values(interfaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

const execFileAsync = promisify(execFile);
const app = express();
const PORT = 3000;

// --- Security: Validate required environment variables ---
// API_ID and API_HASH are required. TELEGRAM_SESSION is optional so the
// first-run interactive login (which prints the session string) still works.
const requiredEnv = ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (!process.env.TELEGRAM_SESSION) {
  console.warn('Warning: TELEGRAM_SESSION is not set. Telegram will prompt for interactive login.');
}

// --- Security: No reverse proxy in local-only mode ---
// Caddy/Tailscale handled external access previously. Running locally without
// a proxy means we should NOT trust X-Forwarded-* headers from clients.
app.set('trust proxy', false);

// --- Security: HTTP security headers ---
app.use(helmet({
  contentSecurityPolicy: false, // Vite dev server needs this disabled
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));

// --- Security: Rate limiting on API routes ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

app.use(express.json());

const VSB_KEY = 'HKCU\\Software\\HWiNFO64\\VSB';
const GPU_FAN_MAX_RPM = 3200;

// Telegram mining bot configuration
const BOT_USERNAME = "KryptexMonitoringBot";

// Structured state holding parsed mining values
const miningData: MiningStats = {
  workerStatus: "offline",
  currentHashrate: "0 TH/s",
  avgHashrate3H: "0 TH/s",
  totalHashrate30m: "0 TH/s",
  balance: "0",
  balanceCurrency: "PRL",
  balanceUsd: "0",
  balanceConfirmed: "0",
  balanceUnconfirmed: "0",
  unconfirmedPercent: 0,
  payoutThreshold: "0",
  profit24h: "0",
  lastUpdated: "Never",
};

// Formats a crypto amount, optionally locking to a specific decimal count
function formatCryptoAmount(value: number, fixedDecimals?: number): string {
  if (!Number.isFinite(value)) return "0";
  
  if (fixedDecimals !== undefined) {
    return value.toFixed(fixedDecimals);
  }

  const trimmed = value
    .toFixed(8)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  return trimmed === "" || trimmed === "-0" ? "0" : trimmed;
}

// Splits the total balance into confirmed / unconfirmed using the
// "Left for payment" percentage, which represents the remaining distance 
// to the payout threshold from the confirmed balance.
function applyBalanceSplit() {
  const total = parseFloat(miningData.balance);
  const threshold = parseFloat(miningData.payoutThreshold);
  const leftPercent = miningData.unconfirmedPercent;

  if (!Number.isFinite(total) || !Number.isFinite(threshold)) {
    miningData.balanceConfirmed = "0";
    miningData.balanceUnconfirmed = "0";
    return;
  }

  const safeLeftPercent = Number.isFinite(leftPercent) ? Math.min(100, Math.max(0, leftPercent)) : 0;
  
  // Confirmed = Threshold * (100% - Left%)
  const confirmed = threshold * (1 - (safeLeftPercent / 100));
  
  // Pending = Total - Confirmed
  const unconfirmed = Math.max(0, total - confirmed);

  // Lock both values to exactly 2 decimal places for UI uniformity
  miningData.balanceUnconfirmed = formatCryptoAmount(unconfirmed, 2);
  miningData.balanceConfirmed = formatCryptoAmount(confirmed, 2);
}

// Regex parsers for bot outputs
function parseBotMessage(text: string) {
  // 1. Parse Workers response
  if (text.includes("Average hashrate") || text.includes("Total hashrate")) {
    // Matches line: "<WorkerName>: <status>, <hashrate>." (e.g., "SSD1: active, 113.91 TH/s.")
    const workerMatch = text.match(/:\s*([a-zA-Z]+),\s*([\d\.]+\s*[A-Za-z\/]+)/);
    if (workerMatch) {
      miningData.workerStatus = workerMatch[1].trim();
      miningData.currentHashrate = workerMatch[2].trim();
    }

    const avgMatch = text.match(/Average hashrate\s*\([^\)]+\):\s*([\d\.]+\s*[A-Za-z\/]+)/i);
    if (avgMatch) miningData.avgHashrate3H = avgMatch[1].trim();

    const totalMatch = text.match(/Total hashrate\s*\([^\)]+\):\s*([\d\.]+\s*[A-Za-z\/]+)/i);
    if (totalMatch) miningData.totalHashrate30m = totalMatch[1].trim();

    miningData.lastUpdated = new Date().toLocaleTimeString();
  }

  // 2. Parse Wallets response
  const hasBalanceLine = text.includes("Balance:");
  const hasPayoutLine = text.includes("Left for payment:") || text.includes("Pending:");

  if (hasBalanceLine && hasPayoutLine) {
    // "Balance: 0.938014 PRL (0.91 USD)."
    const balanceMatch = text.match(
      /Balance:\s*([\d.,]+)\s*([A-Za-z]+)\s*\(\s*([\d.,]+)\s*USD\s*\)/i
    );
    if (balanceMatch) {
      miningData.balance = balanceMatch[1].replace(/,/g, "").trim();
      miningData.balanceCurrency = balanceMatch[2].trim();
      miningData.balanceUsd = balanceMatch[3].replace(/,/g, "").trim();
    } else {
      // Fallback for a balance line without the USD portion.
      const looseMatch = text.match(/Balance:\s*([\d.,]+)\s*([A-Za-z]+)?/i);
      if (looseMatch) {
        miningData.balance = looseMatch[1].replace(/,/g, "").trim();
        if (looseMatch[2]) miningData.balanceCurrency = looseMatch[2].trim();
      }
    }

    // "Left for payment: 1.475789 / 1.0 PRL (28%)."
    // The percentage here is the remaining amount needed to reach the threshold.
    const leftMatch = text.match(
      /(?:Left for payment|Pending)[^:]*:\s*([\d.,]+)\s*\/\s*([\d.,]+)\s*([A-Za-z]+)\s*\(\s*([\d.,]+)\s*%\s*\)/i
    );
    if (leftMatch) {
      miningData.payoutThreshold = leftMatch[2].replace(/,/g, "").trim();
      if (!miningData.balanceCurrency) miningData.balanceCurrency = leftMatch[3].trim();
      const parsedPercent = parseFloat(leftMatch[4].replace(/,/g, ""));
      miningData.unconfirmedPercent = Number.isFinite(parsedPercent) ? parsedPercent : 0;
    }

    const profitMatch = text.match(/Profit for last 24 hours[^:]*:\s*([\d\.]+)/i);
    if (profitMatch) miningData.profit24h = profitMatch[1].trim() + " PRL";

    applyBalanceSplit();

    miningData.lastUpdated = new Date().toLocaleTimeString();
  }
}

interface HistoryPoint {
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

interface HwinfoSensor {
  label: string;
  sensor: string;
  valueRaw: number;
}

const historyBuffer: HistoryPoint[] = [];
const MAX_HISTORY = 30;

let cachedSensors: Map<string, HwinfoSensor> | null = null;

async function startServer() {
  // Initialize your existing Express/Bun server logic here...

  // Prime the wallet cache before the (potentially blocking) Telegram auth and
  // keep it warm on a slow timer. The wallet is read straight from prlctl, so
  // it stays available even if the Telegram session never comes up.
  await refreshWalletBalance();
  setInterval(refreshWalletBalance, WALLET_POLL_MS);

  // Initialize Telegram User Client
  await initTelegram();

  // Event listener for incoming replies from KryptexMonitoringBot
  client.addEventHandler((event: any) => {
    const rawText = event.message?.message;
    if (rawText) {
      parseBotMessage(rawText);
    }
  }, new NewMessage({ chats: [BOT_USERNAME] }));

  // Polling loop: Alternates commands every 10 seconds
  let step = 0;
  setInterval(async () => {
    try {
      if (step % 2 === 0) {
        await client.sendMessage(BOT_USERNAME, { message: "🔨 Workers" });
      } else {
        await client.sendMessage(BOT_USERNAME, { message: "💰 Wallets" });
      }
      step++;
    } catch (err) {
      console.error("Failed to send command to Telegram bot:", err);
    }
  }, 10000);
}

function formatUptime(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days} days, ${hours} hours, ${minutes} minutes`;
}

function parseHardwareName(sensor: string): string {
  // "CPU [#0]: AMD Ryzen 7 5700X3D: Enhanced" → "AMD Ryzen 7 5700X3D"
  // "dGPU [#0]: NVIDIA GeForce RTX 5060 Ti: GIGABYTE..." → "NVIDIA GeForce RTX 5060 Ti"
  const afterPrefix = sensor.replace(/^(?:CPU|dGPU)\s*\[#\d+\]:\s*/i, '');
  const parts = afterPrefix.split(':');
  return (parts[0] || afterPrefix).trim();
}

function parseRegQueryOutput(stdout: string): Map<string, HwinfoSensor> {
  const values = new Map<string, string>();

  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s+(\S+)\s+REG_SZ\s+(.*)$/);
    if (!match) continue;
    values.set(match[1], match[2].trim());
  }

  const indices = new Set<number>();
  for (const key of values.keys()) {
    const m = key.match(/^Label(\d+)$/);
    if (m) indices.add(Number(m[1]));
  }

  const sensors = new Map<string, HwinfoSensor>();
  for (const i of indices) {
    const label = values.get(`Label${i}`);
    if (!label) continue;
    const raw = values.get(`ValueRaw${i}`);
    const valueRaw = raw !== undefined ? Number(raw.replace(/,/g, '')) : NaN;
    if (Number.isNaN(valueRaw)) continue;
    sensors.set(label, {
      label,
      sensor: values.get(`Sensor${i}`) || '',
      valueRaw,
    });
  }

  return sensors;
}

async function readHwinfoRegistry(): Promise<Map<string, HwinfoSensor>> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', VSB_KEY], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const sensors = parseRegQueryOutput(stdout);
    if (sensors.size === 0) {
      throw new Error('HWiNFO VSB registry key has no sensor values');
    }
    cachedSensors = sensors;
    return sensors;
  } catch (err) {
    if (cachedSensors && cachedSensors.size > 0) {
      return cachedSensors;
    }
    throw err;
  }
}

function requireSensor(sensors: Map<string, HwinfoSensor>, label: string): HwinfoSensor {
  const sensor = sensors.get(label);
  if (!sensor) {
    throw new Error(`Missing HWiNFO sensor: ${label}`);
  }
  return sensor;
}

async function collectMetrics() {
  const sensors = await readHwinfoRegistry();

  const cpuLoadSensor = requireSensor(sensors, 'Total CPU Usage');
  const cpuTempSensor = requireSensor(sensors, 'CPU (Tctl/Tdie)');
  const gpuTempSensor = requireSensor(sensors, 'GPU Temperature');
  const gpuMemSensor = requireSensor(sensors, 'GPU Memory Junction Temperature');
  const gpuHotspotSensor = requireSensor(sensors, 'GPU Hot Spot Temperature');
  const gpuFanSensor = requireSensor(sensors, 'GPU Fan1');
  const gpuLoadSensor = requireSensor(sensors, 'GPU Core Load');

  const gpuFanRpm = Math.round(gpuFanSensor.valueRaw);
  const gpuFan = Math.round(Math.min(100, Math.max(0, (gpuFanRpm / GPU_FAN_MAX_RPM) * 100)));
  const gpuTemp = +gpuTempSensor.valueRaw.toFixed(1);
  const gpuHotspot = +gpuHotspotSensor.valueRaw.toFixed(1);
  const gpuMemoryTemp = +gpuMemSensor.valueRaw.toFixed(1);
  const gpuLoad = Math.round(gpuLoadSensor.valueRaw);
  const cpuTemp = +cpuTempSensor.valueRaw.toFixed(1);
  const cpuLoad = Math.round(cpuLoadSensor.valueRaw);

  const [mem, time] = await Promise.all([si.mem(), si.time()]);
  const ramTotalGb = +(mem.total / 1024 ** 3).toFixed(1);
  const ramUsedGb = +(mem.active / 1024 ** 3).toFixed(1);
  const ramPercent = Math.round((mem.active / mem.total) * 100);
  const uptimeSeconds = Math.floor(time.uptime);

  const processorName = parseHardwareName(cpuTempSensor.sensor || cpuLoadSensor.sensor);
  const gpuName = parseHardwareName(gpuTempSensor.sensor);

  const metrics = {
    gpuFan,
    gpuFanRpm,
    gpuTemp,
    gpuHotspot,
    gpuMemoryTemp,
    gpuLoad,
    cpuTemp,
    cpuLoad,
    ramUsedGb,
    ramTotalGb,
    ramPercent,
    uptime: formatUptime(uptimeSeconds),
    uptimeSeconds,
    gpuName,
    processorName,
    lastUpdated: new Date().toISOString(),
  };

  const point: HistoryPoint = {
    timestamp: Date.now(),
    gpuFan,
    gpuTemp,
    gpuHotspot,
    gpuMemoryTemp,
    gpuLoad,
    cpuTemp,
    cpuLoad,
    ramPercent,
  };
  historyBuffer.push(point);
  if (historyBuffer.length > MAX_HISTORY) {
    historyBuffer.shift();
  }

  return { metrics, history: [...historyBuffer] };
}

// --- Local PRL wallet (services/get_balance.py) ---

const WALLET_SCRIPT = path.join(process.cwd(), 'services', 'get_balance.py');
const WALLET_POLL_MS = 60_000;
const WALLET_TIMEOUT_MS = 30_000;

// Windows exposes Python under several names; the first one that responds wins.
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
      continue; // Try the next candidate.
    }
    resolvedPython = bin;
    return bin;
  }

  throw new Error('No Python interpreter found. Set PYTHON_BIN to your python executable.');
}

const walletData: WalletBalance = {
  balance: '0',
  currency: 'PRL',
  available: false,
  error: 'Wallet has not been queried yet',
  lastUpdated: 'Never',
  source: 'prlctl',
};

// Derives a USD estimate for the local wallet from the PRL/USD rate that the
// Kryptex bot reports alongside its own balance figure.
function estimateWalletUsd(amount: number): string | undefined {
  const poolBalance = parseFloat(miningData.balance);
  const poolUsd = parseFloat(miningData.balanceUsd);

  if (!Number.isFinite(poolBalance) || !Number.isFinite(poolUsd) || poolBalance <= 0) {
    return undefined;
  }

  return (amount * (poolUsd / poolBalance)).toFixed(2);
}

// prlctl is a slow wallet RPC call, so the balance is refreshed on a timer and
// cached instead of being queried on every incoming HTTP request.
async function refreshWalletBalance(): Promise<void> {
  try {
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

    walletData.balance = value.toFixed(2);
    walletData.estimatedUsd = estimateWalletUsd(value);
    walletData.available = true;
    walletData.error = undefined;
    walletData.lastUpdated = new Date().toISOString();
  } catch (err) {
    walletData.available = false;
    walletData.error = err instanceof Error ? err.message : String(err);
    console.error('Failed to read PRL wallet balance:', walletData.error);
  }
}

// --- PRL Price Data (CoinGecko) ---

// Maps a UI timeframe to the CoinGecko `days` parameter. CoinGecko returns
// 5-minute granularity for <=1 day and hourly/daily for longer windows.
function timeframeToDays(timeframe: string): string {
  switch (timeframe) {
    case '1h':
      return '1';
    case '6h':
      return '1';
    case '24h':
      return '1';
    case '7d':
      return '7';
    case '30d':
      return '30';
    default:
      return '1';
  }
}

// Trims the CoinGecko series down to the requested lookback window.
function sliceToTimeframe(prices: PricePoint[], timeframe: string): PricePoint[] {
  const now = Date.now();
  const windowMs: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  const cutoff = now - (windowMs[timeframe] ?? windowMs['24h']);
  const filtered = prices.filter((p) => p.timestamp >= cutoff);
  return filtered.length >= 2 ? filtered : prices;
}

// Fetches the PRL market chart from CoinGecko and normalizes it into PriceData.
async function fetchPriceData(timeframe: string): Promise<PriceData> {
  const days = timeframeToDays(timeframe);
  const url =
    `${COINGECKO_API}/coins/${PRL_COINGECKO_ID}/market_chart` +
    `?vs_currency=usd&days=${days}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`CoinGecko responded ${response.status}: ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    prices?: [number, number][];
    total_volumes?: [number, number][];
  };

  const rawPrices = payload.prices ?? [];
  if (rawPrices.length === 0) {
    throw new Error('CoinGecko returned no price points for PRL');
  }

  // Align volumes to price timestamps when the API supplies them.
  const volumes = payload.total_volumes ?? [];
  const volumeByTime = new Map<number, number>();
  for (const [ts, vol] of volumes) {
    volumeByTime.set(ts, vol);
  }

  const prices: PricePoint[] = rawPrices.map(([timestamp, price]) => ({
    timestamp,
    price,
    volume: volumeByTime.get(timestamp),
  }));

  const windowed = sliceToTimeframe(prices, timeframe);
  const values = windowed.map((p) => p.price);
  const currentPrice = values[values.length - 1];
  const firstPrice = values[0];

  return {
    prices: windowed,
    currentPrice,
    priceChange24h: currentPrice - firstPrice,
    priceChangePercent24h: firstPrice !== 0 ? ((currentPrice - firstPrice) / firstPrice) * 100 : 0,
    high24h: Math.max(...values),
    low24h: Math.min(...values),
    lastUpdated: Date.now(),
    available: true,
  };
}

// Serves cached price data, refreshing at most once per PRICE_CACHE_MS per timeframe.
async function getPriceData(timeframe: string): Promise<PriceData> {
  const now = Date.now();
  const cached = priceCache.get(timeframe);
  if (cached && now - cached.time < PRICE_CACHE_MS) {
    return cached.data;
  }

  try {
    const data = await fetchPriceData(timeframe);
    priceCache.set(timeframe, { data, time: now });
    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Fall back to a stale entry for this timeframe if we have one.
    if (cached) {
      return { ...cached.data, error: message };
    }
    return {
      prices: [],
      currentPrice: 0,
      priceChange24h: 0,
      priceChangePercent24h: 0,
      high24h: 0,
      low24h: 0,
      lastUpdated: now,
      available: false,
      error: message,
    };
  }
}

// --- API Routes ---
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy' });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy' });
});

app.get('/api', (_req: Request, res: Response) => {
  res.json({ message: 'Hardware Monitor Dashboard API is running' });
});

app.get('/api/dashboard', async (_req: Request, res: Response) => {
  try {
    const data = await collectMetrics();
    res.json(data);
  } catch (err) {
    console.error('Failed to read hardware metrics:', err);
    res.status(503).json({
      error: 'HWiNFO Shared Memory (VSB) data is unavailable. Ensure HWiNFO is running with Shared Memory enabled.',
    });
  }
});

app.get('/api/stats', async (_req: Request, res: Response) => {
  try {
    const data = await collectMetrics();
    res.json(data);
  } catch (err) {
    console.error('Failed to read hardware metrics:', err);
    res.status(503).json({
      error: 'HWiNFO Shared Memory (VSB) data is unavailable. Ensure HWiNFO is running with Shared Memory enabled.',
    });
  }
});

// Mining stats from KryptexMonitoringBot
app.get('/api/miner', (_req: Request, res: Response) => {
  res.json(miningData);
});

// Local PRL wallet balance read from prlctl
app.get('/api/wallet', (_req: Request, res: Response) => {
  res.json(walletData);
});

// PRL price history from CoinGecko.
// Query params:
//   timeframe - one of 1h | 6h | 24h | 7d | 30d (default 24h)
app.get('/api/prl-price', async (req: Request, res: Response) => {
  const raw = req.query.timeframe;
  const timeframe = typeof raw === 'string' ? raw : '24h';
  const allowed = ['1h', '6h', '24h', '7d', '30d'];
  const safeTimeframe = allowed.includes(timeframe) ? timeframe : '24h';

  try {
    const data = await getPriceData(safeTimeframe);
    res.json(data);
  } catch (err) {
    console.error('Failed to fetch PRL price data:', err);
    res.status(503).json({
      prices: [],
      currentPrice: 0,
      priceChange24h: 0,
      priceChangePercent24h: 0,
      high24h: 0,
      low24h: 0,
      lastUpdated: Date.now(),
      available: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// 1. Ensure ViteDevServer is imported at the top of your file
import { ViteDevServer } from 'vite'; 
// (assuming your createViteServer import is already there)

// ...

// --- Vite / Static Handling ---
async function setupViteOrStatic() {
  // 2. Explicitly type the variable
  let vite: ViteDevServer | undefined; 

  if (process.env.NODE_ENV !== 'production') {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Bind to 0.0.0.0 so the dashboard is reachable from other devices on the
  // local network (phone, laptop, etc.) without Tailscale. Access is still
  // confined to the LAN — nothing is exposed to the public internet.
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nHardware Monitor running (no Tailscale/Caddy needed):`);
    console.log(`  Local:   http://127.0.0.1:${PORT}`);
    for (const ip of getLanAddresses()) {
      console.log(`  Network: http://${ip}:${PORT}`);
    }
    console.log('');
  });

  const shutdown = async () => {
    console.log('\nClosing server and releasing port...');
    
    if (vite) {
      await vite.close();
    }

    server.close(() => {
      console.log('Port released. Exiting.');
      process.exit(0);
    });
    
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer();
setupViteOrStatic();
