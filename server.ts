import express, { Request, Response } from 'express';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createServer as createViteServer } from 'vite';
import si from 'systeminformation';

const execFileAsync = promisify(execFile);
const app = express();
const PORT = 3000;

app.use(express.json());

const VSB_KEY = 'HKCU\\Software\\HWiNFO64\\VSB';
const GPU_FAN_MAX_RPM = 3200;

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

function formatUptime(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days} days, ${hours} hours, ${minutes} minutes`;
}

function parseHardwareName(sensor: string): string {
  // "CPU [#0]: AMD Ryzen 7 5700X3D: Enhanced" → "AMD Ryzen 7 5700X3D"
  // "dGPU [#0]: NVIDIA GeForce RTX 3060 Ti: GIGABYTE..." → "NVIDIA GeForce RTX 3060 Ti"
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

setupViteOrStatic();
