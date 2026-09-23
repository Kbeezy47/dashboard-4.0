import React from 'react';
import StatCard from './StatCard';
import { MiningStats, WalletBalance } from '../types';
import {
  Landmark,
  Wallet,
  Hourglass,
  Coins,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';

interface WalletBalancePanelProps {
  wallet: WalletBalance | null;
  mining: MiningStats | null;
}

// Renders an ISO timestamp as a local time string, falling back to "Never".
function formatTimestamp(iso: string | undefined): string {
  if (!iso || iso === 'Never') return 'Never';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleTimeString();
}

// Parses a numeric string, returning null when it is missing or malformed.
function toAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

const WalletBalancePanel: React.FC<WalletBalancePanelProps> = ({ wallet, mining }) => {
  const currency = wallet?.currency || mining?.balanceCurrency || 'PRL';
  const available = wallet?.available === true;

  // Only trust the wallet figure when the last prlctl read actually succeeded,
  // so a failed query never renders as a real 0.00 balance.
  const walletAmount = available ? toAmount(wallet?.balance) : null;
  const poolAmount = toAmount(mining?.balance);

  // Everything the rig has earned: what already landed in the wallet plus
  // whatever is still accruing on the pool.
  const combined =
    walletAmount !== null && poolAmount !== null ? walletAmount + poolAmount : null;

  // PRL -> USD rate implied by the pool's own balance/USD pair, so any PRL
  // figure can be converted the same way the server converts the wallet one.
  const usdRate = (() => {
    const poolUsdValue = toAmount(mining?.balanceUsd);
    if (poolAmount === null || poolUsdValue === null || poolAmount <= 0) return null;
    return poolUsdValue / poolAmount;
  })();

  const poolUsd =
    poolAmount !== null && usdRate !== null
      ? `≈ $${(poolAmount * usdRate).toFixed(2)} USD`
      : undefined;

  const combinedUsd =
    combined !== null && usdRate !== null
      ? `≈ $${(combined * usdRate).toFixed(2)} USD`
      : undefined;

  return (
    <div className="space-y-6">
      {/* Wallet Header Bar */}
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 sm:p-5 backdrop-blur flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-sm">
          <div className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-purple-400" />
            <span className="text-neutral-400 font-medium">Source:</span>
            <span className="text-white font-semibold">{wallet?.source || 'prlctl'}</span>
          </div>

          <div className="flex items-center gap-2">
            {available ? (
              <CheckCircle2 className="w-4 h-4 text-green-400" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400" />
            )}
            <span className="text-neutral-400 font-medium">Wallet:</span>
            <span className={`font-semibold ${available ? 'text-green-400' : 'text-red-400'}`}>
              {available ? 'Connected' : 'Unavailable'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-neutral-300 font-mono">
          <Clock className="w-4 h-4 text-neutral-400" />
          <span className="text-neutral-400">Last Update:</span>
          <span>{formatTimestamp(wallet?.lastUpdated)}</span>
        </div>
      </div>

      {/* Unavailable banner */}
      {wallet && !available && (
        <div className="bg-amber-950/40 border border-amber-800/70 text-amber-200 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold mb-0.5">Unable to read the local PRL wallet</p>
            <p className="text-amber-300/80 font-mono text-xs break-words">
              {wallet.error || 'prlctl did not return a balance.'}
            </p>
          </div>
        </div>
      )}

      {/* Balance Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Landmark className="w-5 h-5 text-purple-400" />
            Local Wallet
          </h2>
          <span className="text-xs text-neutral-400 font-mono">prlctl • 60s Poll</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Wallet Balance */}
          <StatCard
            icon={<Wallet className="w-5 h-5 text-purple-400" />}
            title="Wallet Balance"
            value={walletAmount !== null ? walletAmount.toFixed(2) : '--'}
            unit={currency}
            subValue={
              available && wallet?.estimatedUsd ? `≈ $${wallet.estimatedUsd} USD` : undefined
            }
            valueClassName="text-purple-400"
            accentColor="purple"
          />

          {/* Still on the pool */}
          <StatCard
            icon={<Hourglass className="w-5 h-5 text-orange-400" />}
            title="On Pool"
            value={poolAmount !== null ? poolAmount.toFixed(2) : '--'}
            unit={currency}
            subValue={poolUsd ?? 'Awaiting payout'}
            valueClassName="text-orange-400"
            accentColor="orange"
          />

          {/* Combined total */}
          <StatCard
            icon={<Coins className="w-5 h-5 text-green-400" />}
            title="Combined Total"
            value={combined !== null ? combined.toFixed(2) : '--'}
            unit={currency}
            subValue={combinedUsd ?? 'Wallet + Pool'}
            valueClassName="text-green-400"
            accentColor="green"
          />
        </div>
      </div>
    </div>
  );
};

export default WalletBalancePanel;
