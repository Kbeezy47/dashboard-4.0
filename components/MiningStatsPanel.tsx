import React from 'react';
import StatCard from './StatCard';
import { MiningStats } from '../types';
import {
  Pickaxe,
  Activity,
  TrendingUp,
  Gauge,
  Wallet,
  Hourglass,
  Coins,
  Clock,
} from 'lucide-react';

interface MiningStatsPanelProps {
  data: MiningStats | null;
}

// Splits "113.91 TH/s" into { value: "113.91", unit: "TH/s" }
function splitValueUnit(raw: string): { value: string; unit: string } {
  const match = raw.match(/^([\d.,]+)\s*(.*)$/);
  if (!match) return { value: raw, unit: '' };
  return { value: match[1], unit: match[2] };
}

const getStatusColor = (status: string): string => {
  const s = status.toLowerCase();
  if (s.includes('active') || s.includes('online')) return 'text-green-400';
  if (s.includes('offline') || s.includes('inactive')) return 'text-red-400';
  return 'text-amber-400';
};

const MiningStatsPanel: React.FC<MiningStatsPanelProps> = ({ data }) => {
  const current = splitValueUnit(data?.currentHashrate || '0 TH/s');
  const avg = splitValueUnit(data?.avgHashrate3H || '0 TH/s');
  const total = splitValueUnit(data?.totalHashrate30m || '0 TH/s');
  const profit = splitValueUnit(data?.profit24h || '0 PRL');

  return (
    <div className="space-y-6">
      {/* Mining Header Bar */}
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 sm:p-5 backdrop-blur flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-sm">
          <div className="flex items-center gap-2">
            <Pickaxe className="w-4 h-4 text-amber-400" />
            <span className="text-neutral-400 font-medium">Worker:</span>
            <span className={`font-semibold ${getStatusColor(data?.workerStatus || 'offline')}`}>
              {data?.workerStatus || 'offline'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-neutral-300 font-mono">
          <Clock className="w-4 h-4 text-neutral-400" />
          <span className="text-neutral-400">Last Update:</span>
          <span>{data?.lastUpdated || 'Never'}</span>
        </div>
      </div>

      {/* Mining Stats Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Pickaxe className="w-5 h-5 text-amber-400" />
            Mining Statistics
          </h2>
          <span className="text-xs text-neutral-400 font-mono">
            Kryptex • 10s Poll
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Current Hashrate */}
          <StatCard
            icon={<Activity className="w-5 h-5 text-green-400" />}
            title="Current Hashrate"
            value={data ? current.value : '--'}
            unit={current.unit}
            subValue="Live"
            valueClassName="text-green-400"
            accentColor="green"
          />

          {/* Avg Hashrate 3H */}
          <StatCard
            icon={<TrendingUp className="w-5 h-5 text-cyan-400" />}
            title="Avg Hashrate"
            value={data ? avg.value : '--'}
            unit={avg.unit}
            subValue="3 Hours"
            valueClassName="text-cyan-400"
            accentColor="cyan"
          />

          {/* Total Hashrate 30m */}
          <StatCard
            icon={<Gauge className="w-5 h-5 text-blue-400" />}
            title="Total Hashrate"
            value={data ? total.value : '--'}
            unit={total.unit}
            subValue="30 Minutes"
            valueClassName="text-blue-400"
            accentColor="blue"
          />

          {/* Profit 24h */}
          <StatCard
            icon={<Coins className="w-5 h-5 text-amber-400" />}
            title="Profit 24h"
            value={data ? profit.value : '--'}
            unit={profit.unit}
            subValue="PRL"
            valueClassName="text-amber-400"
            accentColor="orange"
          />

          {/* Balance */}
          <StatCard
            icon={<Wallet className="w-5 h-5 text-purple-400" />}
            title="Balance"
            value={data?.balance || '--'}
            subValue="Confirmed"
            valueClassName="text-purple-400"
            accentColor="purple"
          />

          {/* Pending */}
          <StatCard
            icon={<Hourglass className="w-5 h-5 text-orange-400" />}
            title="Pending"
            value={data?.pending || '--'}
            subValue="Left for payment"
            valueClassName="text-orange-400"
            accentColor="orange"
          />
        </div>
      </div>
    </div>
  );
};

export default MiningStatsPanel;
