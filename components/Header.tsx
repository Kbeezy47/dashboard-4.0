import React, { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';

const Header: React.FC = () => {
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
      setCurrentDate(
        now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="bg-neutral-950/80 backdrop-blur-md border-b border-neutral-800/80 sticky top-0 z-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight flex items-center gap-2">
                Hardware Monitor
                <span className="hidden sm:inline-block text-xs font-normal text-neutral-400 border border-neutral-800 rounded px-1.5 py-0.5">
                  SK Neon
                </span>
              </h1>
              <p className="text-xs text-neutral-400 hidden sm:block">
                Real-time HWiNFO64 sensor telemetry
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            {/* Clock & Date from Rainmeter spec */}
            <div className="text-right font-mono hidden xs:block">
              <div className="text-sm font-semibold text-white tracking-wide">{currentTime}</div>
              <div className="text-xs text-neutral-400">{currentDate}</div>
            </div>

            {/* Live Indicator */}
            <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 px-2.5 py-1.5 rounded-full">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
              </span>
              <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">
                Live
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
