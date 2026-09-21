import { DashboardData } from '../types';

export const fetchDashboardData = async (): Promise<DashboardData> => {
  const response = await fetch('/api/dashboard');
  if (!response.ok) {
    throw new Error('Failed to fetch hardware dashboard metrics');
  }
  return response.json();
};
