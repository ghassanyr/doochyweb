// Timeframe list for the Analysis UI. The server owns the canonical list
// (`GET /api/market/config`); this module only holds the static fallback used
// before that request resolves, so the tab strip can render immediately.

export const timeframes = [
  { id: "1m", label: "1 min" },
  { id: "3m", label: "3 min" },
  { id: "5m", label: "5 min" },
  { id: "15m", label: "15 min" },
  { id: "30m", label: "30 min" },
  { id: "1h", label: "1 hour" },
  { id: "4h", label: "4 hours" },
  { id: "1d", label: "1 day" },
  { id: "1w", label: "1 week" },
  { id: "1M", label: "1 month" },
];

export const DEFAULT_TIMEFRAME = "4h";