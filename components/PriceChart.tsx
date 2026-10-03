import React, { useState, useMemo, useRef } from 'react';
import { PriceData, Timeframe, AverageAlgorithm } from '../types';
import { TrendingUp, TrendingDown, LineChart, Activity, Clock, AlertCircle } from 'lucide-react';

interface PriceChartProps {
  data: PriceData | null;
  loading?: boolean;
  error?: string | null;
  onTimeframeChange?: (timeframe: Timeframe) => void;
}

// --- Averaging algorithms ---

// Simple Moving Average: unweighted mean of the previous `period` points.
function computeSMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - j];
    result.push(sum / period);
  }
  return result;
}

// Exponential Moving Average: weights recent points more heavily via a smoothing factor.
function computeEMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  if (values.length === 0) return result;
  const k = 2 / (period + 1);
  let ema = values[0];
  result.push(ema);
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// Bollinger Bands: SMA middle band with upper/lower bands at `multiplier` standard deviations.
function computeBollinger(
  values: number[],
  period: number,
  multiplier: number
): { middle: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const middle = computeSMA(values, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < values.length; i++) {
    const m = middle[i];
    if (m === null || i < period - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let sumSq = 0;
    for (let j = 0; j < period; j++) {
      const diff = values[i - j] - m;
      sumSq += diff * diff;
    }
    const stdDev = Math.sqrt(sumSq / period);
    upper.push(m + multiplier * stdDev);
    lower.push(m - multiplier * stdDev);
  }

  return { middle, upper, lower };
}

// --- Formatting helpers ---

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '--';
  // Sub-cent tokens need more precision; larger values read better with fewer decimals.
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.01) return value.toFixed(5);
  return value.toFixed(8);
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '--';
  return `$${formatPrice(value)}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatTime(timestamp: number, timeframe: Timeframe): string {
  const date = new Date(timestamp);
  if (timeframe === '7d' || timeframe === '30d') {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- Chart geometry ---

const CHART_WIDTH = 800;
const CHART_HEIGHT = 260;
const PADDING = { top: 20, right: 60, bottom: 30, left: 20 };

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1h', label: '1H' },
  { value: '6h', label: '6H' },
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
];

const ALGORITHMS: { value: AverageAlgorithm; label: string; icon: React.ReactNode }[] = [
  { value: 'raw', label: 'Raw', icon: <LineChart className="w-3.5 h-3.5" /> },
  { value: 'sma', label: 'SMA', icon: <Activity className="w-3.5 h-3.5" /> },
  { value: 'ema', label: 'EMA', icon: <TrendingUp className="w-3.5 h-3.5" /> },
  { value: 'bb', label: 'BB', icon: <TrendingDown className="w-3.5 h-3.5" /> },
];

// Default lookback windows per timeframe, in periods.
const DEFAULT_PERIODS: Record<Timeframe, number> = {
  '1h': 5,
  '6h': 10,
  '24h': 20,
  '7d': 20,
  '30d': 20,
};

const PriceChart: React.FC<PriceChartProps> = ({
  data,
  loading = false,
  error = null,
  onTimeframeChange,
}) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('24h');
  const [algorithm, setAlgorithm] = useState<AverageAlgorithm>('raw');
  const [period, setPeriod] = useState<number>(DEFAULT_PERIODS['24h']);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const prices = data?.prices ?? [];
  const values = useMemo(() => prices.map((p) => p.price), [prices]);

  // Compute the active overlay series for the selected algorithm.
  const overlay = useMemo(() => {
    if (values.length === 0) return null;
    const safePeriod = Math.max(2, Math.min(period, values.length));

    switch (algorithm) {
      case 'sma':
        return { type: 'sma' as const, series: computeSMA(values, safePeriod) };
      case 'ema':
        return { type: 'ema' as const, series: computeEMA(values, safePeriod) };
      case 'bb': {
        const bands = computeBollinger(values, safePeriod, 2);
        return { type: 'bb' as const, ...bands };
      }
      default:
        return null;
    }
  }, [values, algorithm, period]);

  // Determine overall direction for the color scheme.
  const isUp = (data?.priceChangePercent24h ?? 0) >= 0;
  const lineColor = isUp ? '#4ade80' : '#f87171';

  // Build the SVG path data from the price series.
  const geometry = useMemo(() => {
    if (prices.length < 2) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min === 0 ? 1 : max - min;

    const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
    const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

    const xFor = (idx: number) =>
      PADDING.left + (idx / (prices.length - 1)) * innerWidth;
    const yFor = (val: number) =>
      PADDING.top + innerHeight - ((val - min) / range) * innerHeight;

    const points = prices.map((p, idx) => ({
      x: xFor(idx),
      y: yFor(p.price),
      price: p.price,
      timestamp: p.timestamp,
    }));

    const linePath = `M ${points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ')}`;
    const areaPath =
      `M ${PADDING.left},${PADDING.top + innerHeight} ` +
      `L ${points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ')} ` +
      `L ${PADDING.left + innerWidth},${PADDING.top + innerHeight} Z`;

    // Helper to build a path from a nullable series, breaking on gaps.
    const seriesPath = (series: (number | null)[]): string | null => {
      const segments: string[] = [];
      let current: string[] = [];
      series.forEach((val, idx) => {
        if (val === null) {
          if (current.length > 0) {
            segments.push(current.join(' L '));
            current = [];
          }
          return;
        }
        current.push(`${xFor(idx).toFixed(2)},${yFor(val).toFixed(2)}`);
      });
      if (current.length > 0) segments.push(current.join(' L '));
      if (segments.length === 0) return null;
      return segments.map((s) => `M ${s}`).join(' ');
    };

    return {
      points,
      linePath,
      areaPath,
      seriesPath,
      min,
      max,
      innerWidth,
      innerHeight,
      xFor,
      yFor,
    };
  }, [prices, values]);

  const handleTimeframeChange = (next: Timeframe) => {
    setTimeframe(next);
    setPeriod(DEFAULT_PERIODS[next]);
    onTimeframeChange?.(next);
  };

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!geometry || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH;
    const innerWidth = geometry.innerWidth;
    const ratio = (x - PADDING.left) / innerWidth;
    const idx = Math.round(ratio * (prices.length - 1));
    setHoverIndex(Math.max(0, Math.min(prices.length - 1, idx)));
  };

  const handleMouseLeave = () => setHoverIndex(null);

  const hovered = hoverIndex !== null ? prices[hoverIndex] : null;
  const hoveredPoint = hoverIndex !== null ? geometry?.points[hoverIndex] : null;

  // Loading / error / empty states
  const showEmpty = !loading && !error && prices.length < 2;

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 sm:p-5 backdrop-blur flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-sm">
          <div className="flex items-center gap-2">
            <LineChart className="w-4 h-4 text-green-400" />
            <span className="text-neutral-400 font-medium">Market:</span>
            <span className="text-white font-semibold">PRL / USD</span>
          </div>

          <div className="flex items-center gap-2">
            {isUp ? (
              <TrendingUp className="w-4 h-4 text-green-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-400" />
            )}
            <span className="text-neutral-400 font-medium">Change:</span>
            <span className={`font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
              {data ? formatPercent(data.priceChangePercent24h) : '--'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-neutral-300 font-mono">
          <Clock className="w-4 h-4 text-neutral-400" />
          <span className="text-neutral-400">Updated:</span>
          <span>
            {data?.lastUpdated
              ? new Date(data.lastUpdated).toLocaleTimeString()
              : 'Never'}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-950/40 border border-red-800/70 text-red-200 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold mb-0.5">Unable to load PRL price data</p>
            <p className="text-red-300/80 font-mono text-xs break-words">{error}</p>
          </div>
        </div>
      )}

      {/* Chart panel */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <LineChart className="w-5 h-5 text-green-400" />
            PRL Price Chart
          </h2>

          {/* Timeframe selector */}
          <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-lg p-1">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                onClick={() => handleTimeframeChange(tf.value)}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                  timeframe === tf.value
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>

        {/* Algorithm tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-lg p-1">
            {ALGORITHMS.map((algo) => (
              <button
                key={algo.value}
                onClick={() => setAlgorithm(algo.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                  algorithm === algo.value
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                }`}
              >
                {algo.icon}
                {algo.label}
              </button>
            ))}
          </div>

          {/* Period control (only relevant for SMA/EMA/BB) */}
          {algorithm !== 'raw' && (
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span className="font-mono">Period:</span>
              <input
                type="range"
                min={2}
                max={Math.max(2, Math.min(50, values.length))}
                value={period}
                onChange={(e) => setPeriod(Number(e.target.value))}
                className="w-24 accent-cyan-400"
              />
              <span className="font-mono text-cyan-400 w-6">{period}</span>
            </div>
          )}
        </div>

        {/* Chart card */}
        <div className="bg-neutral-900/90 backdrop-blur border border-neutral-800 p-4 sm:p-5 rounded-xl shadow-lg">
          {/* Current price summary */}
          <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-400 font-semibold mb-1">
                Current Price
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className="text-2xl sm:text-3xl font-bold tracking-tight"
                  style={{ color: lineColor }}
                >
                  {data ? formatUsd(data.currentPrice) : '--'}
                </span>
                <span
                  className={`text-sm font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}
                >
                  {data ? formatPercent(data.priceChangePercent24h) : ''}
                </span>
              </div>
            </div>

            <div className="flex gap-6 text-xs font-mono">
              <div>
                <div className="text-neutral-400 mb-0.5">High</div>
                <div className="text-green-400 font-semibold">
                  {data ? formatUsd(data.high24h) : '--'}
                </div>
              </div>
              <div>
                <div className="text-neutral-400 mb-0.5">Low</div>
                <div className="text-red-400 font-semibold">
                  {data ? formatUsd(data.low24h) : '--'}
                </div>
              </div>
            </div>
          </div>

          {/* SVG chart */}
          <div className="relative">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/60 rounded-lg z-10">
                <div className="flex items-center gap-2 text-neutral-400 text-sm">
                  <Activity className="w-4 h-4 animate-spin" />
                  Loading price data...
                </div>
              </div>
            )}

            {showEmpty ? (
              <div className="h-[260px] flex items-center justify-center text-neutral-500 text-sm">
                No price data available
              </div>
            ) : (
              geometry && (
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                  className="w-full h-[260px]"
                  preserveAspectRatio="none"
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                >
                  <defs>
                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
                      <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal grid lines + price labels */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                    const y = PADDING.top + ratio * geometry.innerHeight;
                    const value = geometry.max - ratio * (geometry.max - geometry.min);
                    return (
                      <g key={ratio}>
                        <line
                          x1={PADDING.left}
                          y1={y}
                          x2={PADDING.left + geometry.innerWidth}
                          y2={y}
                          stroke="rgba(255,255,255,0.06)"
                          strokeWidth="1"
                        />
                        <text
                          x={PADDING.left + geometry.innerWidth + 8}
                          y={y + 4}
                          fill="#737373"
                          fontSize="10"
                          fontFamily="monospace"
                        >
                          {formatPrice(value)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Area fill under the price line */}
                  <path d={geometry.areaPath} fill="url(#priceGradient)" />

                  {/* Bollinger Bands (drawn behind the price line) */}
                  {overlay?.type === 'bb' && (
                    <>
                      <path
                        d={geometry.seriesPath(overlay.upper) ?? ''}
                        fill="none"
                        stroke="#c084fc"
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                        opacity="0.8"
                      />
                      <path
                        d={geometry.seriesPath(overlay.lower) ?? ''}
                        fill="none"
                        stroke="#c084fc"
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                        opacity="0.8"
                      />
                      <path
                        d={geometry.seriesPath(overlay.middle) ?? ''}
                        fill="none"
                        stroke="#a78bfa"
                        strokeWidth="1.5"
                        opacity="0.9"
                      />
                    </>
                  )}

                  {/* Main price line */}
                  <path
                    d={geometry.linePath}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* SMA / EMA overlay line */}
                  {(overlay?.type === 'sma' || overlay?.type === 'ema') && (
                    <path
                      d={geometry.seriesPath(overlay.series) ?? ''}
                      fill="none"
                      stroke={overlay.type === 'sma' ? '#22d3ee' : '#fbbf24'}
                      strokeWidth="1.75"
                      strokeDasharray="5 3"
                      opacity="0.95"
                    />
                  )}

                  {/* Hover crosshair + marker */}
                  {hoveredPoint && (
                    <>
                      <line
                        x1={hoveredPoint.x}
                        y1={PADDING.top}
                        x2={hoveredPoint.x}
                        y2={PADDING.top + geometry.innerHeight}
                        stroke="rgba(255,255,255,0.25)"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                      <circle
                        cx={hoveredPoint.x}
                        cy={hoveredPoint.y}
                        r="4"
                        fill={lineColor}
                        stroke="#121212"
                        strokeWidth="2"
                      />
                    </>
                  )}

                  {/* X-axis time labels */}
                  {[0, 0.5, 1].map((ratio) => {
                    const idx = Math.round(ratio * (prices.length - 1));
                    const point = prices[idx];
                    if (!point) return null;
                    const x = geometry.xFor(idx);
                    return (
                      <text
                        key={ratio}
                        x={x}
                        y={CHART_HEIGHT - 8}
                        fill="#737373"
                        fontSize="10"
                        fontFamily="monospace"
                        textAnchor={ratio === 0 ? 'start' : ratio === 1 ? 'end' : 'middle'}
                      >
                        {formatTime(point.timestamp, timeframe)}
                      </text>
                    );
                  })}
                </svg>
              )
            )}

            {/* Tooltip */}
            {hovered && hoveredPoint && (
              <div
                className="absolute pointer-events-none bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 shadow-xl z-20"
                style={{
                  left: `${(hoveredPoint.x / CHART_WIDTH) * 100}%`,
                  top: '8px',
                  transform:
                    hoveredPoint.x > CHART_WIDTH * 0.6
                      ? 'translateX(-110%)'
                      : 'translateX(10%)',
                }}
              >
                <div className="text-sm font-bold text-white">
                  {formatUsd(hovered.price)}
                </div>
                <div className="text-xs text-neutral-400 font-mono">
                  {new Date(hovered.timestamp).toLocaleString()}
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 mt-4 pt-3 border-t border-neutral-800/60 text-xs">
            <div className="flex items-center gap-1.5">
              <span
                className="w-3 h-0.5 rounded"
                style={{ backgroundColor: lineColor }}
              />
              <span className="text-neutral-400">Price</span>
            </div>
            {algorithm === 'sma' && (
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded bg-cyan-400" />
                <span className="text-neutral-400">SMA ({period})</span>
              </div>
            )}
            {algorithm === 'ema' && (
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded bg-amber-400" />
                <span className="text-neutral-400">EMA ({period})</span>
              </div>
            )}
            {algorithm === 'bb' && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 rounded bg-purple-400" />
                  <span className="text-neutral-400">BB Middle ({period})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 rounded bg-purple-400 opacity-60" />
                  <span className="text-neutral-400">Bands (±2σ)</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PriceChart;
