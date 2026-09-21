import React from 'react';
import StatCard from './StatCard';
import { DashboardData } from '../types';
import {
  Fan,
  Thermometer,
  Flame,
  Activity,
  Cpu,
  HardDrive,
  Clock,
  Monitor,
  Zap,
} from 'lucide-react';

interface SystemInfoPanelProps {
  data: DashboardData | null;
}

const getTempColor = (temp: number | undefined, thresholdHigh = 80, thresholdWarm = 70): string => {
  if (temp === undefined) return 'text-white';
  if (temp >= thresholdHigh) return 'text-red-400';
  if (temp >= thresholdWarm) return 'text-amber-400';
  return 'text-green-400';
};

const getLoadColor = (load: number | undefined): string => {
  if (load === undefined) return 'text-white';
  if (load >= 90) return 'text-red-400';
  if (load >= 75) return 'text-orange-400';
  if (load >= 50) return 'text-cyan-400';
  return 'text-green-400';
};

const SystemInfoPanel: React.FC<SystemInfoPanelProps> = ({ data }) => {
  const metrics = data?.metrics;
  const history = data?.history || [];

  const gpuFanHistory = history.map((h) => h.gpuFan);
  const gpuTempHistory = history.map((h) => h.gpuTemp);
  const gpuHotspotHistory = history.map((h) => h.gpuHotspot);
  const gpuMemHistory = history.map((h) => h.gpuMemoryTemp);
  const gpuLoadHistory = history.map((h) => h.gpuLoad);
  const cpuTempHistory = history.map((h) => h.cpuTemp);
  const cpuLoadHistory = history.map((h) => h.cpuLoad);
  const ramHistory = history.map((h) => h.ramPercent);

  return (
    <div className="space-y-6">
      {/* Hardware Identifiers & Quick Header Bar */}
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 sm:p-5 backdrop-blur flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-sm">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-green-400" />
            <span className="text-neutral-400 font-medium">GPU:</span>
            <span className="text-white font-semibold">{metrics?.gpuName || 'GPU Hardware'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <span className="text-neutral-400 font-medium">CPU:</span>
            <span className="text-white font-semibold">{metrics?.processorName || 'Host Processor'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-neutral-300 font-mono">
          <Clock className="w-4 h-4 text-neutral-400" />
          <span className="text-neutral-400">Uptime:</span>
          <span>{metrics?.uptime || 'Calculating...'}</span>
        </div>
      </div>

      {/* 8 Rainmeter Neon Meters Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Zap className="w-5 h-5 text-green-400" />
            Live Hardware Meters
          </h2>
          <span className="text-xs text-neutral-400 font-mono">
            8 Channels • 1000ms Poll
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* BOX 1: GPU FAN */}
          <StatCard
            icon={<Fan className="w-5 h-5 text-green-400 animate-spin" style={{ animationDuration: metrics?.gpuFan ? `${Math.max(0.5, 4 - (metrics.gpuFan / 30))}s` : '3s' }} />}
            title="GPU Fan"
            value={metrics ? metrics.gpuFan : '--'}
            unit="%"
            subValue={metrics ? `${metrics.gpuFanRpm} RPM` : ''}
            progress={metrics?.gpuFan}
            history={gpuFanHistory}
            accentColor="green"
          />

          {/* BOX 2: GPU TEMP */}
          <StatCard
            icon={<Thermometer className="w-5 h-5 text-green-400" />}
            title="GPU Temp"
            value={metrics ? metrics.gpuTemp.toFixed(1) : '--'}
            unit="°C"
            subValue="Core"
            valueClassName={getTempColor(metrics?.gpuTemp, 80, 70)}
            progress={metrics ? (metrics.gpuTemp / 100) * 100 : undefined}
            history={gpuTempHistory}
            accentColor={metrics && metrics.gpuTemp >= 80 ? 'red' : metrics && metrics.gpuTemp >= 70 ? 'orange' : 'green'}
          />

          {/* BOX 3: GPU HOTSPOT */}
          <StatCard
            icon={<Flame className="w-5 h-5 text-orange-400" />}
            title="GPU Hotspot"
            value={metrics ? metrics.gpuHotspot.toFixed(1) : '--'}
            unit="°C"
            subValue="Hotspot"
            valueClassName={getTempColor(metrics?.gpuHotspot, 90, 80)}
            progress={metrics ? (metrics.gpuHotspot / 110) * 100 : undefined}
            history={gpuHotspotHistory}
            accentColor={metrics && metrics.gpuHotspot >= 90 ? 'red' : 'orange'}
          />

          {/* BOX 4: GPU MEMORY */}
          <StatCard
            icon={<Thermometer className="w-5 h-5 text-purple-400" />}
            title="GPU Memory"
            value={metrics ? metrics.gpuMemoryTemp.toFixed(1) : '--'}
            unit="°C"
            subValue="Junction"
            valueClassName={getTempColor(metrics?.gpuMemoryTemp, 92, 82)}
            progress={metrics ? (metrics.gpuMemoryTemp / 110) * 100 : undefined}
            history={gpuMemHistory}
            accentColor="purple"
          />

          {/* BOX 5: GPU LOAD */}
          <StatCard
            icon={<Activity className="w-5 h-5 text-cyan-400" />}
            title="GPU Load"
            value={metrics ? metrics.gpuLoad : '--'}
            unit="%"
            subValue="D3D Load"
            valueClassName={getLoadColor(metrics?.gpuLoad)}
            progress={metrics?.gpuLoad}
            history={gpuLoadHistory}
            accentColor="cyan"
          />

          {/* BOX 6: CPU TEMP */}
          <StatCard
            icon={<Thermometer className="w-5 h-5 text-green-400" />}
            title="CPU Temp"
            value={metrics ? metrics.cpuTemp.toFixed(1) : '--'}
            unit="°C"
            subValue="Tctl/Tdie"
            valueClassName={getTempColor(metrics?.cpuTemp, 80, 70)}
            progress={metrics ? (metrics.cpuTemp / 100) * 100 : undefined}
            history={cpuTempHistory}
            accentColor={metrics && metrics.cpuTemp >= 80 ? 'red' : metrics && metrics.cpuTemp >= 70 ? 'orange' : 'green'}
          />

          {/* BOX 7: CPU LOAD */}
          <StatCard
            icon={<Cpu className="w-5 h-5 text-blue-400" />}
            title="CPU Load"
            value={metrics ? metrics.cpuLoad : '--'}
            unit="%"
            subValue="Total"
            valueClassName={getLoadColor(metrics?.cpuLoad)}
            progress={metrics?.cpuLoad}
            history={cpuLoadHistory}
            accentColor="blue"
          />

          {/* BOX 8: MEMORY */}
          <StatCard
            icon={<HardDrive className="w-5 h-5 text-purple-400" />}
            title="Memory"
            value={metrics ? metrics.ramPercent : '--'}
            unit="%"
            subValue={metrics ? `${metrics.ramUsedGb} / ${metrics.ramTotalGb} GB` : ''}
            valueClassName="text-white"
            progress={metrics?.ramPercent}
            history={ramHistory}
            accentColor="purple"
          />
        </div>
      </div>
    </div>
  );
};

export default SystemInfoPanel;
