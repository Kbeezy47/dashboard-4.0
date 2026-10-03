# PRL Price Chart Implementation Plan

## Overview
Add a 24-hour line graph for Pearl (PRL) price with color-coded price movement, multiple averaging algorithms via tabs, and adjustable timeframes.

## Architecture

### 1. Backend API Endpoint (`/api/prl-price`)
- Fetch price data from CoinGecko API (free, no key required)
- CoinGecko ID: `pearl` (need to verify)
- Cache responses for 60 seconds to avoid rate limits
- Return structured data: prices array, current price, 24h change, timestamps

### 2. Frontend Component: `PriceChart.tsx`
- SVG-based line chart (matching existing StatCard sparkline style)
- Color-coded: green for price up, red for price down
- Tabs for averaging algorithms:
  - Raw Price (no average)
  - SMA (Simple Moving Average) - configurable period
  - EMA (Exponential Moving Average) - configurable period
  - VWAP (Volume Weighted Average Price) - if volume data available
- Timeframe selector: 1h, 6h, 24h, 7d, 30d
- Responsive design matching dashboard theme

### 3. Integration
- Add to App.tsx after WalletBalancePanel
- Add polling/refresh logic (every 60 seconds)
- Add types to types.ts

## Implementation Steps

### Step 1: Backend - Add Price API Endpoint
- Add CoinGecko fetch logic to server.ts
- Add caching mechanism
- Add `/api/prl-price` endpoint with query params for timeframe

### Step 2: Types
- Add PriceData, PricePoint interfaces to types.ts
- Add PriceChartProps interface

### Step 3: Frontend - PriceChart Component
- Create components/PriceChart.tsx
- Implement SVG line chart with:
  - Price line (color-coded by direction)
  - Average lines (SMA, EMA, VWAP)
  - Grid lines and labels
  - Tooltip on hover
  - Timeframe selector dropdown
  - Algorithm tabs

### Step 4: Algorithm Implementations
- SMA: Simple average over N periods
- EMA: Exponential weighting
- VWAP: Volume-weighted (if volume available from CoinGecko)

### Step 5: Integration
- Import and use in App.tsx
- Add fetch logic with polling
- Add loading/error states

### Step 6: Styling
- Match existing dashboard theme (dark, neon accents)
- Use existing color palette (green/red for price direction)
- Responsive grid layout

## API Details

### CoinGecko Endpoints
- Current price: `/simple/price?ids=pearl&vs_currencies=usd&include_24hr_change=true`
- Market chart: `/coins/pearl/market_chart?vs_currency=usd&days=1` (for 24h)
- Market chart: `/coins/pearl/market_chart?vs_currency=usd&days=7` (for 7d)
- Market chart: `/coins/pearl/market_chart?vs_currency=usd&days=30` (for 30d)

Response format for market_chart:
```json
{
  "prices": [[timestamp, price], ...],
  "market_caps": [[timestamp, market_cap], ...],
  "total_volumes": [[timestamp, volume], ...]
}
```

## Component Structure

```
PriceChart/
├── PriceChart.tsx (main component)
├── PriceChartTabs.tsx (algorithm tabs)
├── TimeframeSelector.tsx (dropdown)
├── PriceLine.tsx (SVG line rendering)
├── PriceTooltip.tsx (hover tooltip)
└── usePriceData.ts (custom hook for fetching)
```

## Color Scheme
- Price up: `#4ade80` (green-400)
- Price down: `#f87171` (red-400)
- Grid lines: `rgba(255,255,255,0.05)`
- Text: `text-neutral-400`
- Background: `bg-neutral-900/90`

## Polling Strategy
- Initial fetch on mount
- Poll every 60 seconds (matching wallet poll)
- Cache on frontend to prevent unnecessary re-renders