/**
 * Centralised number-formatting utilities.
 * All display numbers in the app should go through here — no ad-hoc toFixed
 * or string templates scattered across components.
 */

/**
 * Dollar cost with adaptive precision.
 *   0        → $0.00
 *   0.000123 → $0.0001  (4 sig figs for tiny amounts)
 *   0.0142   → $0.0142
 *   0.142    → $0.142
 *   1.42     → $1.42
 *   142.4    → $142.40
 */
export function fmtCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001)  return `$${usd.toFixed(5)}`;
  if (usd < 0.01)   return `$${usd.toFixed(4)}`;
  if (usd < 0.1)    return `$${usd.toFixed(3)}`;
  if (usd < 10)     return `$${usd.toFixed(2)}`;
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Token count: commas up to 999,999 then k/M suffix.
 *   834      → 834
 *   1,234    → 1,234
 *   12,345   → 12,345
 *   123,456  → 123,456
 *   1,234,567 → 1.23M
 */
export function fmtTokens(n: number): string {
  if (n < 1_000_000) return Math.round(n).toLocaleString("en-US");
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Percentage with two decimal places.
 *   12.3456 → "12.35%"
 */
export function fmtPercent(p: number): string {
  return `${p.toFixed(2)}%`;
}

/**
 * Plain integer with comma separators.
 *   1234567 → "1,234,567"
 */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
