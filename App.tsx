import React, { useState, useEffect } from 'react';
import { DashboardData, MiningStats } from './types';
import { fetchDashboardData, fetchMinerData } from './services/api';
import Header from './components/Header';
import SystemInfoPanel from './components/SystemInfoPanel';
import MiningStatsPanel from './components/MiningStatsPanel';
import { RefreshCw, AlertCircle } from 'lucide-react';

const App: React.FC = () => {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [miningData, setMiningData] = useState<MiningStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        const data = await fetchDashboardData();
        if (isMounted) {
          setDashboardData(data);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError("Failed to fetch hardware data. Please ensure the backend server is running.");
          console.error(err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    const fetchMining = async () => {
      try {
        const data = await fetchMinerData();
        if (isMounted) {
          setMiningData(data);
        }
      } catch (err) {
        console.error('Failed to fetch mining stats:', err);
      }
    };

    fetchData(); // Initial fetch
    fetchMining(); // Initial mining fetch
    const intervalId = setInterval(fetchData, 1000); // Poll every 1s per Rainmeter Update=1000
    const miningIntervalId = setInterval(fetchMining, 5000); // Poll mining stats every 5s

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      clearInterval(miningIntervalId);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#121212] text-white font-sans antialiased selection:bg-green-500 selection:text-black">
      <Header />
      <main className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-7xl">
        {loading ? (
          <div className="flex flex-col justify-center items-center h-80 space-y-4">
            <RefreshCw className="w-8 h-8 text-green-400 animate-spin" />
            <p className="text-base text-neutral-400 font-mono">Initializing Hardware Telemetry...</p>
          </div>
        ) : error ? (
          <div className="bg-red-950/40 border border-red-800 text-red-200 p-6 rounded-xl text-center max-w-xl mx-auto my-12">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="font-bold text-lg mb-1">Hardware API Connection Error</p>
            <p className="text-sm text-red-300/80 mb-4">{error}</p>
            <button
              onClick={() => {
                setLoading(true);
                setError(null);
                fetchDashboardData()
                  .then((data) => setDashboardData(data))
                  .catch((err) => setError(String(err)))
                  .finally(() => setLoading(false));
              }}
              className="px-4 py-2 bg-red-900/60 hover:bg-red-800 text-white text-xs font-semibold rounded-lg transition-colors border border-red-700/60"
            >
              Retry Connection
            </button>
          </div>
        ) : dashboardData ? (
          <div className="space-y-8">
            <SystemInfoPanel data={dashboardData} />
            <MiningStatsPanel data={miningData} />
          </div>
        ) : null}
      </main>
    </div>
  );
};

export default App;
