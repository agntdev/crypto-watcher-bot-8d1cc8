/**
 * Injectable clock seam for all schedule / cutoff / "now" decisions.
 * Override in tests via `setNow()`; restore with `resetNow()`.
 */

let nowImpl: () => number = () => Date.now();

/** Current epoch ms — use this instead of Date.now() / new Date(). */
export function now(): number {
  return nowImpl();
}

/** Override the clock (tests). Pass a fixed epoch ms or a function. */
export function setNow(value: number | (() => number)): void {
  nowImpl = typeof value === "function" ? value : () => value;
}

/** Restore the real wall clock. */
export function resetNow(): void {
  nowImpl = () => Date.now();
}

/** Format epoch ms as HH:mm in a fixed UTC offset (minutes east of UTC). */
export function formatHm(epochMs: number, offsetMinutes = 0): string {
  const d = new Date(epochMs + offsetMinutes * 60_000);
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

/** Parse "HH:mm" or "H:mm" into { hours, minutes }. Returns null if invalid. */
export function parseHm(text: string): { hours: number; minutes: number } | null {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/** Minutes since midnight for an HH:mm string (local offset applied to epoch). */
export function minutesSinceMidnight(epochMs: number, offsetMinutes = 0): number {
  const d = new Date(epochMs + offsetMinutes * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function hmToMinutes(hm: string): number | null {
  const p = parseHm(hm);
  if (!p) return null;
  return p.hours * 60 + p.minutes;
}
