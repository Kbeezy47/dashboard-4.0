import { DashboardData, MiningStats } from '../types';

export const fetchDashboardData = async (): Promise<DashboardData> => {
  const response = await fetch('/api/dashboard');
  if (!response.ok) {
    throw new Error('Failed to fetch hardware dashboard metrics');
  }
  return response.json();
};

export const fetchMinerData = async (): Promise<MiningStats> => {
  const response = await fetch('/api/miner');
  if (!response.ok) {
    throw new Error('Failed to fetch mining stats');
  }
  return response.json();
};
