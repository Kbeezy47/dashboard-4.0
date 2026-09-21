Here is a clear specification for the backend API that the frontend dashboard is designed to consume. To get the dashboard running, you'll only need to create a single API endpoint.
Backend API Specification
The frontend expects a single, unified data source that it polls periodically for fresh data.
Endpoint: A single GET endpoint. For example: GET /api/dashboard
Response Format: The endpoint must return a JSON object.
Polling Frequency: The frontend is currently configured to call this endpoint every 3 seconds to get live updates.
Required JSON Data Structure
The JSON response from your GET /api/dashboard endpoint must match the following structure and data types exactly.
Generated json
{
  "systemInfo": {
    "cpuUsage": 50.5,
    "cpuTemp": 68.2,
    "gpuUsage": 99.1,
    "gpuTemp": 75.5
  },
  "miningInfo": {
    "currentCoin": "QUAI",
    "hashrate": 123.45,
    "hashrateUnit": "MH/s",
    "uptime": "1d 4h 22m 10s"
  },
  "earnings": [
    {
      "coin": "QUAI",
      "dailyEstimate": 3.73
    },
    {
      "coin": "CFX",
      "dailyEstimate": 2.77
    },
    {
      "coin": "FLUX",
      "dailyEstimate": 3.85
    },
    {
      "coin": "XMR",
      "dailyEstimate": 1.99
    }
  ]
}

Json
Field Descriptions
systemInfo (Object): Contains all metrics related to the system hardware.
cpuUsage (Number): CPU utilization percentage.
cpuTemp (Number): CPU temperature in Celsius.
gpuUsage (Number): GPU utilization percentage.
gpuTemp (Number): GPU temperature in Celsius.
miningInfo (Object): Contains all metrics related to the mining operation.
currentCoin (String): The ticker or name of the coin currently being mined.
hashrate (Number): The current hashing speed.
hashrateUnit (String): The unit for the hashrate (e.g., "MH/s", "kH/s").
uptime (String): A formatted string representing how long the miner has been active.
earnings (Array of Objects): A list containing the estimated daily earnings for each coin you want to track.
coin (String): The name/ticker of the cryptocurrency.
dailyEstimate (Number): The estimated earnings for that coin in USD for a 24-hour period.
How to Integrate
Once your backend endpoint is live and serving data in this format, you will only need to make a small change in one file:
Open the services/api.ts file.
Replace the existing mock fetchDashboardData function with a real fetch call to your new endpoint. A commented-out example is already there to guide you.
That's it. The frontend will then start pulling and displaying the live data from your backend.