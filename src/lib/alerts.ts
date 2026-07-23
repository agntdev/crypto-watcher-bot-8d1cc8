/**
 * Alert evaluation, cooldown, quiet-hours queue, and delivery helpers.
 */

import { now } from "./clock.js";
import {
  ALERT_COOLDOWN_MS,
  DEFAULT_PERCENT_TIMEFRAME_MIN,
  type AlertRule,
  type UserRecord,
} from "./models.js";
import { isInQuietHours } from "./quiet-hours.js";
import {
  enqueueAlert,
  getQueuedAlerts,
  getUser,
  listQueuedUserIds,
  listUserIds,
  recordNotification,
  saveUser,
  setQueuedAlerts,
  updateAlertRule,
} from "./users.js";
import { formatUsd, getPricesForTickers, type CoinPrice } from "./prices.js";

export interface FiredAlert {
  user: UserRecord;
  rule: AlertRule;
  old_price: number;
  new_price: number;
  message: string;
}

export function formatAlertMessage(
  rule: AlertRule,
  oldPrice: number,
  newPrice: number,
): string {
  if (rule.alert_type === "threshold") {
    const dir = rule.direction === "below" ? "dropped below" : "rose above";
    return (
      `Alert: ${rule.coin_ticker} ${dir} ${formatUsd(rule.threshold_price ?? 0)}.\n` +
      `Now ${formatUsd(newPrice)} (was ${formatUsd(oldPrice)}).`
    );
  }
  const pct = rule.percent_move ?? 0;
  const move = oldPrice === 0 ? 0 : ((newPrice - oldPrice) / oldPrice) * 100;
  const sign = move >= 0 ? "+" : "";
  return (
    `Alert: ${rule.coin_ticker} moved ${sign}${move.toFixed(2)}% ` +
    `(threshold ${pct}%) over ${rule.timeframe ?? DEFAULT_PERCENT_TIMEFRAME_MIN}m.\n` +
    `${formatUsd(oldPrice)} → ${formatUsd(newPrice)}.`
  );
}

function onCooldown(rule: AlertRule, at: number): boolean {
  if (!rule.last_alert_time) return false;
  return at - rule.last_alert_time < ALERT_COOLDOWN_MS;
}

/**
 * Evaluate a single rule against current + anchor prices.
 * Returns a FiredAlert draft or null.
 */
export function evaluateRule(
  user: UserRecord,
  rule: AlertRule,
  price: CoinPrice,
  at: number = now(),
): FiredAlert | null {
  if (onCooldown(rule, at)) return null;

  if (rule.alert_type === "threshold") {
    const thr = rule.threshold_price;
    if (thr === undefined || !rule.direction) return null;
    const prev = user.last_seen_prices[rule.coin_ticker];
    const crossed =
      rule.direction === "above"
        ? price.usd >= thr && (prev === undefined || prev < thr)
        : price.usd <= thr && (prev === undefined || prev > thr);
    if (!crossed) return null;
    const old_price = prev ?? price.usd;
    return {
      user,
      rule,
      old_price,
      new_price: price.usd,
      message: formatAlertMessage(rule, old_price, price.usd),
    };
  }

  // Percent move over timeframe window.
  const pct = rule.percent_move ?? 0;
  const timeframeMin = rule.timeframe ?? DEFAULT_PERCENT_TIMEFRAME_MIN;
  let anchor = rule.window_anchor_price;
  let anchorTime = rule.window_anchor_time;
  if (anchor === undefined || anchorTime === undefined) {
    // First observation — set anchor, no fire yet.
    return null;
  }
  if (at - anchorTime > timeframeMin * 60_000) {
    // Window expired — caller should refresh anchor; no fire on stale window alone.
    // Still evaluate from anchor if within 2× window to catch the move.
    if (at - anchorTime > timeframeMin * 60_000 * 2) return null;
  }
  if (anchor === 0) return null;
  const movePct = Math.abs(((price.usd - anchor) / anchor) * 100);
  if (movePct < pct) return null;
  return {
    user,
    rule,
    old_price: anchor,
    new_price: price.usd,
    message: formatAlertMessage(rule, anchor, price.usd),
  };
}

export type SendFn = (chatId: number, text: string) => Promise<void>;

/**
 * Deliver or queue a fired alert. Tolerates 403 from blocked users.
 */
export async function deliverAlert(
  fired: FiredAlert,
  send: SendFn,
  at: number = now(),
): Promise<"sent" | "queued" | "skipped"> {
  const quiet = isInQuietHours(
    at,
    fired.user.quiet_hours,
    fired.user.timezone_offset_minutes,
  );

  if (quiet) {
    await enqueueAlert({
      user_id: fired.user.telegram_id,
      rule_id: fired.rule.id,
      coin_ticker: fired.rule.coin_ticker,
      alert_type: fired.rule.alert_type,
      old_price: fired.old_price,
      new_price: fired.new_price,
      queued_at: at,
      message: fired.message,
    });
    await updateAlertRule(fired.user.telegram_id, fired.rule.id, {
      last_alert_time: at,
    });
    return "queued";
  }

  try {
    await send(fired.user.telegram_id, fired.message);
  } catch {
    // 403 / network — do not abort broader loops
    return "skipped";
  }

  await recordNotification({
    user_id: fired.user.telegram_id,
    coin_ticker: fired.rule.coin_ticker,
    alert_type: fired.rule.alert_type,
    trigger_time: at,
    old_price: fired.old_price,
    new_price: fired.new_price,
  });
  await updateAlertRule(fired.user.telegram_id, fired.rule.id, {
    last_alert_time: at,
    window_anchor_price: fired.new_price,
    window_anchor_time: at,
  });
  return "sent";
}

/** Evaluate all users' rules against live prices and deliver/queue. */
export async function runAlertPass(send: SendFn): Promise<number> {
  const at = now();
  const userIds = await listUserIds();
  let actions = 0;

  for (const uid of userIds) {
    const user = await getUser(uid);
    if (!user || user.alert_rules.length === 0) continue;

    const tickers = [
      ...new Set(user.alert_rules.map((r) => r.coin_ticker.toUpperCase())),
    ];
    let prices: Map<string, CoinPrice>;
    try {
      prices = await getPricesForTickers(tickers);
    } catch {
      // Price feed failure — retry next tick, no user notification.
      continue;
    }

    let dirty = false;
    for (const rule of user.alert_rules) {
      const price = prices.get(rule.coin_ticker.toUpperCase());
      if (!price) continue;

      // Maintain percent-move anchors.
      if (rule.alert_type === "percent") {
        const tf = (rule.timeframe ?? DEFAULT_PERCENT_TIMEFRAME_MIN) * 60_000;
        if (
          rule.window_anchor_price === undefined ||
          rule.window_anchor_time === undefined ||
          at - rule.window_anchor_time > tf
        ) {
          rule.window_anchor_price = price.usd;
          rule.window_anchor_time = at;
          dirty = true;
        }
      }

      const fired = evaluateRule(user, rule, price, at);
      // Update last_seen after evaluation so threshold crossing uses previous price.
      user.last_seen_prices[rule.coin_ticker.toUpperCase()] = price.usd;
      dirty = true;

      if (fired) {
        // Re-bind user snapshot for deliver
        fired.user = user;
        const result = await deliverAlert(fired, send, at);
        if (result !== "skipped") actions++;
      }
    }
    if (dirty) await saveUser(user);
  }

  return actions;
}

/**
 * Flush queued alerts after quiet hours end.
 * Re-validates threshold/percent so stale alerts are dropped.
 */
export async function flushQueuedAlerts(send: SendFn): Promise<number> {
  const at = now();
  const userIds = await listQueuedUserIds();
  let sent = 0;

  for (const uid of userIds) {
    const user = await getUser(uid);
    if (!user) {
      await setQueuedAlerts(uid, []);
      continue;
    }
    if (isInQuietHours(at, user.quiet_hours, user.timezone_offset_minutes)) {
      continue; // still quiet
    }

    const queue = await getQueuedAlerts(uid);
    if (queue.length === 0) continue;

    const remaining: typeof queue = [];
    const tickers = [...new Set(queue.map((q) => q.coin_ticker))];
    let prices: Map<string, CoinPrice> = new Map();
    try {
      prices = await getPricesForTickers(tickers);
    } catch {
      continue;
    }

    for (const item of queue) {
      const rule = user.alert_rules.find((r) => r.id === item.rule_id);
      const price = prices.get(item.coin_ticker.toUpperCase());
      if (!rule || !price) {
        // Drop stale / deleted
        continue;
      }

      // Stale check: condition must still hold at current price.
      let stillValid = false;
      if (rule.alert_type === "threshold" && rule.threshold_price !== undefined) {
        stillValid =
          rule.direction === "above"
            ? price.usd >= rule.threshold_price
            : price.usd <= rule.threshold_price;
      } else if (rule.alert_type === "percent") {
        const anchor = item.old_price;
        const pct = rule.percent_move ?? 0;
        if (anchor > 0) {
          const move = Math.abs(((price.usd - anchor) / anchor) * 100);
          stillValid = move >= pct;
        }
      }

      if (!stillValid) continue;

      const message = formatAlertMessage(rule, item.old_price, price.usd);
      try {
        await send(uid, message);
        await recordNotification({
          user_id: uid,
          coin_ticker: item.coin_ticker,
          alert_type: item.alert_type,
          trigger_time: at,
          old_price: item.old_price,
          new_price: price.usd,
        });
        sent++;
      } catch {
        remaining.push(item);
      }
    }
    await setQueuedAlerts(uid, remaining);
  }
  return sent;
}
