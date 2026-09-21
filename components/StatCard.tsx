import React from 'react';

interface StatCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  unit?: string;
  subValue?: string;
  valueClassName?: string;
  progress?: number; // 0 to 100
  history?: number[]; // past data points for sparkline
  accentColor?: 'green' | 'cyan' | 'blue' | 'purple' | 'orange' | 'red';
}

const colorMap = {
  green: {
    stroke: '#4ade80',
    fill: 'rgba(74, 222, 128, 0.15)',
    bar: 'bg-green-500',
    border: 'hover:border-green-500/40',
  },
  cyan: {
    stroke: '#22d3ee',
    fill: 'rgba(34, 211, 238, 0.15)',
    bar: 'bg-cyan-500',
    border: 'hover:border-cyan-500/40',
  },
  blue: {
    stroke: '#60a5fa',
    fill: 'rgba(96, 165, 250, 0.15)',
    bar: 'bg-blue-500',
    border: 'hover:border-blue-500/40',
  },
  purple: {
    stroke: '#c084fc',
    fill: 'rgba(192, 132, 252, 0.15)',
    bar: 'bg-purple-500',
    border: 'hover:border-purple-500/40',
  },
  orange: {
    stroke: '#fb923c',
    fill: 'rgba(251, 146, 60, 0.15)',
    bar: 'bg-orange-500',
    border: 'hover:border-orange-500/40',
  },
  red: {
    stroke: '#f87171',
    fill: 'rgba(248, 113, 113, 0.15)',
    bar: 'bg-red-500',
    border: 'hover:border-red-500/40',
  },
};

const StatCard: React.FC<StatCardProps> = ({
  icon,
  title,
  value,
  unit,
  subValue,
  valueClassName,
  progress,
  history,
  accentColor = 'green',
}) => {
  const colors = colorMap[accentColor] || colorMap.green;

  // Generate SVG sparkline path
  const renderSparkline = () => {
    if (!history || history.length < 2) return null;

    const width = 120;
    const height = 32;
    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = max - min === 0 ? 1 : max - min;

    const points = history.map((val, idx) => {
      const x = (idx / (history.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const pathData = `M ${points.join(' L ')}`;
    const areaData = `M 0,${height} L ${points.join(' L ')} L ${width},${height} Z`;

    return (
      <div className="mt-2.5 pt-2 border-t border-neutral-800/60">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-7 overflow-visible"
          preserveAspectRatio="none"
        >
          <path d={areaData} fill={colors.fill} />
          <path
            d={pathData}
            fill="none"
            stroke={colors.stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  };

  return (
    <div
      className={`bg-neutral-900/90 backdrop-blur border border-neutral-800 p-4 sm:p-5 rounded-xl shadow-lg flex flex-col justify-between transition-all duration-200 hover:-translate-y-0.5 ${colors.border}`}
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-neutral-800/80 text-neutral-300">
              {icon}
            </div>
            <span className="text-xs sm:text-sm font-semibold tracking-wide text-neutral-400 uppercase">
              {title}
            </span>
          </div>
          {subValue && (
            <span className="text-xs text-neutral-400 font-mono">
              {subValue}
            </span>
          )}
        </div>

        <div className="flex items-baseline justify-between mt-1">
          <p className={`text-2xl sm:text-3xl font-bold tracking-tight ${valueClassName || 'text-white'}`}>
            {value}
            {unit && (
              <span className="text-sm sm:text-base font-normal text-neutral-400 ml-1.5">
                {unit}
              </span>
            )}
          </p>
        </div>

        {/* Optional Progress / Meter Bar */}
        {progress !== undefined && (
          <div className="w-full bg-neutral-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${colors.bar}`}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        )}
      </div>

      {renderSparkline()}
    </div>
  );
};

export default StatCard;
