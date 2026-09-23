import express, { Request, Response } from 'express';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createServer as createViteServer } from 'vite';
import si from 'systeminformation';
import { initTelegram, client } from "./services/telegramClient";
import { NewMessage } from "telegram/events";
import { MiningStats } from './types';

const execFileAsync = promisify(execFile);
const app = express();
const PORT = 3000;

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

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hardware Monitor running on http://0.0.0.0:${PORT}`);
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
