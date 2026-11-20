import type { Candle } from "../market/types";

export function parseHandPickTarget(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim().replace(/[,\s]/g, "");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return null;
  const target = Number(raw);
  return Number.isFinite(target) && target > 0 ? target : null;
}

export function resolveHandPickTarget(
  bars: Candle[],
  target: number,
  since: number
): number | null {
  if (!Number.isFinite(target) || !Number.isFinite(since)) return null;
  let reference: number | null = null;
  for (const bar of bars) {
    if (!Number.isFinite(bar.time) || bar.time < since) continue;
    if (reference === null && Number.isFinite(bar.open)) reference = bar.open;
    if (reference === null) continue;
    const rising = target >= reference;
    if (rising && Number.isFinite(bar.high) && bar.high >= target) return bar.time;
    if (!rising && Number.isFinite(bar.low) && bar.low <= target) return bar.time;
  }
  return null;
}
