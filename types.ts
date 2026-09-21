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

// Mining Stats from KryptexMonitoringBot
export interface MiningStats {
  workerStatus: string;
  currentHashrate: string;
  avgHashrate3H: string;
  totalHashrate30m: string;
  balance: string;
  pending: string;
  profit24h: string;
  lastUpdated: string;
}