/**
 * Morning summary scheduling — opt-in daily digest at the user's local time.
 */

import { formatHm, now } from "./clock.js";
import { formatChange, formatUsd, getPricesForTickers } from "./prices.js";
import {
  getUser,
  listSummaryUserIds,
  recordNotification,
  saveUser,
} from "./users.js";

export type SendFn = (chatId: number, text: string) => Promise<void>;

function localDateKey(epochMs: number, offsetMinutes: number): string {
  const d = new Date(epochMs + offsetMinutes * 60_000);
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function buildSummaryText(userId: number): Promise<string | null> {
  const user = await getUser(userId);
  if (!user || user.watchlist.length === 0) {
    return "Morning summary: your watchlist is empty — tap Add Coin to start.";
  }
  const tickers = user.watchlist.map((w) => w.ticker);
  let prices;
  try {
    prices = await getPricesForTickers(tickers);
  } catch {
    return null; // silent retry later
  }

  const lines = ["Morning summary — your watchlist:"];
  for (const item of user.watchlist) {
    const p = prices.get(item.ticker);
    if (!p) {
      lines.push(`• ${item.display_name} (${item.ticker}): unavailable`);
      continue;
    }
    lines.push(
      `• ${item.display_name} (${item.ticker}): ${formatUsd(p.usd)} (${formatChange(p.change_24h)} 24h)`,
    );
    user.last_seen_prices[item.ticker] = p.usd;
  }
  lines.push("\nNot financial advice.");
  await saveUser(user);
  return lines.join("\n");
}

/**
 * Send morning summaries for users whose local HH:mm matches their preference
 * and who have not already received one today.
 */
export async function runMorningSummaries(send: SendFn): Promise<number> {
  const at = now();
  const ids = await listSummaryUserIds();
  let sent = 0;

  for (const uid of ids) {
    const user = await getUser(uid);
    if (!user || !user.summary_enabled || !user.summary_time) continue;

    const localHm = formatHm(at, user.timezone_offset_minutes);
    // Match on the minute (scheduler runs ~every minute).
    if (localHm !== user.summary_time) continue;

    const dateKey = localDateKey(at, user.timezone_offset_minutes);
    if (user.last_summary_date === dateKey) continue;

    const text = await buildSummaryText(uid);
    if (!text) continue;

    try {
      await send(uid, text);
      user.last_summary_date = dateKey;
      await saveUser(user);
      await recordNotification({
        user_id: uid,
        coin_ticker: "*",
        alert_type: "summary",
        trigger_time: at,
      });
      sent++;
    } catch {
      // 403 blocked — skip without aborting the loop
    }
  }
  return sent;
}
