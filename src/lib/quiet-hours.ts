/**
 * Quiet hours — suppress alerts between start and end (supports overnight windows).
 */

import { hmToMinutes, minutesSinceMidnight } from "./clock.js";
import type { QuietHours } from "./models.js";

/**
 * True when `epochMs` falls inside quiet hours for the given local offset.
 * Overnight windows (e.g. 22:00–07:00) wrap past midnight.
 */
export function isInQuietHours(
  epochMs: number,
  quiet: QuietHours,
  offsetMinutes = 0,
): boolean {
  if (!quiet.enabled) return false;
  const start = hmToMinutes(quiet.start);
  const end = hmToMinutes(quiet.end);
  if (start === null || end === null) return false;

  const cur = minutesSinceMidnight(epochMs, offsetMinutes);

  if (start === end) {
    // Same start/end with enabled = full-day quiet.
    return true;
  }
  if (start < end) {
    // Same-day window, e.g. 13:00–17:00
    return cur >= start && cur < end;
  }
  // Overnight, e.g. 22:00–07:00
  return cur >= start || cur < end;
}
