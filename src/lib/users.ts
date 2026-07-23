/**
 * User repository — durable User records with explicit indices (no key scans).
 */

import { kvGet, kvSet } from "./kv.js";
import { now } from "./clock.js";
import {
  DEFAULT_QUIET_HOURS,
  type AlertRule,
  type NotificationRecord,
  type QueuedAlert,
  type UserRecord,
  type WatchlistItem,
} from "./models.js";

const userKey = (id: number) => `user:${id}`;
const USERS_INDEX = "idx:users";
const ALERT_COUNTS = "idx:alert_counts";
const NOTIF_INDEX = "idx:notif_ids";
const notifKey = (id: string) => `notif:${id}`;
const QUEUE_INDEX = "idx:queued_user_ids";
const queueKey = (userId: number) => `queue:${userId}`;
const SUMMARY_INDEX = "idx:summary_users";

let idSeq = 0;
function newId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${now().toString(36)}_${idSeq.toString(36)}`;
}

export async function getUser(telegramId: number): Promise<UserRecord | undefined> {
  return kvGet<UserRecord>(userKey(telegramId));
}

export async function ensureUser(telegramId: number): Promise<UserRecord> {
  const existing = await getUser(telegramId);
  if (existing) {
    existing.updated_at = now();
    await kvSet(userKey(telegramId), existing);
    return existing;
  }
  const user: UserRecord = {
    telegram_id: telegramId,
    watchlist: [],
    alert_rules: [],
    quiet_hours: { ...DEFAULT_QUIET_HOURS },
    summary_time: null,
    summary_enabled: false,
    timezone_offset_minutes: 0,
    last_seen_prices: {},
    created_at: now(),
    updated_at: now(),
  };
  await kvSet(userKey(telegramId), user);
  const idx = (await kvGet<number[]>(USERS_INDEX)) ?? [];
  if (!idx.includes(telegramId)) {
    idx.push(telegramId);
    await kvSet(USERS_INDEX, idx);
  }
  return user;
}

export async function saveUser(user: UserRecord): Promise<void> {
  user.updated_at = now();
  await kvSet(userKey(user.telegram_id), user);
}

export async function listUserIds(): Promise<number[]> {
  return (await kvGet<number[]>(USERS_INDEX)) ?? [];
}

export async function totalUsers(): Promise<number> {
  return (await listUserIds()).length;
}

export async function addWatchlistItem(
  telegramId: number,
  item: WatchlistItem,
): Promise<UserRecord> {
  const user = await ensureUser(telegramId);
  const ticker = item.ticker.toUpperCase();
  const existing = user.watchlist.find((w) => w.ticker === ticker);
  if (existing) {
    existing.display_name = item.display_name;
    if (item.coingecko_id) existing.coingecko_id = item.coingecko_id;
  } else {
    user.watchlist.push({
      ticker,
      display_name: item.display_name,
      coingecko_id: item.coingecko_id,
    });
  }
  await saveUser(user);
  return user;
}

export async function removeWatchlistItem(
  telegramId: number,
  ticker: string,
): Promise<UserRecord> {
  const user = await ensureUser(telegramId);
  const t = ticker.toUpperCase();
  user.watchlist = user.watchlist.filter((w) => w.ticker !== t);
  user.alert_rules = user.alert_rules.filter((r) => r.coin_ticker !== t);
  delete user.last_seen_prices[t];
  await saveUser(user);
  return user;
}

export async function addAlertRule(
  telegramId: number,
  rule: Omit<AlertRule, "id">,
): Promise<AlertRule> {
  const user = await ensureUser(telegramId);
  const full: AlertRule = { ...rule, id: newId("al") };
  user.alert_rules.push(full);
  await saveUser(user);
  return full;
}

export async function removeAlertRule(
  telegramId: number,
  ruleId: string,
): Promise<void> {
  const user = await ensureUser(telegramId);
  user.alert_rules = user.alert_rules.filter((r) => r.id !== ruleId);
  await saveUser(user);
}

export async function updateAlertRule(
  telegramId: number,
  ruleId: string,
  patch: Partial<AlertRule>,
): Promise<AlertRule | undefined> {
  const user = await ensureUser(telegramId);
  const rule = user.alert_rules.find((r) => r.id === ruleId);
  if (!rule) return undefined;
  Object.assign(rule, patch);
  await saveUser(user);
  return rule;
}

export async function recordNotification(
  rec: Omit<NotificationRecord, "id">,
): Promise<NotificationRecord> {
  const full: NotificationRecord = { ...rec, id: newId("n") };
  await kvSet(notifKey(full.id), full);
  const ids = (await kvGet<string[]>(NOTIF_INDEX)) ?? [];
  ids.push(full.id);
  // Cap index to last 500 notifications.
  const trimmed = ids.length > 500 ? ids.slice(ids.length - 500) : ids;
  await kvSet(NOTIF_INDEX, trimmed);

  if (rec.alert_type === "threshold" || rec.alert_type === "percent") {
    const counts = (await kvGet<Record<string, number>>(ALERT_COUNTS)) ?? {};
    const key = `${rec.coin_ticker}:${rec.alert_type}`;
    counts[key] = (counts[key] ?? 0) + 1;
    await kvSet(ALERT_COUNTS, counts);
  }
  return full;
}

export async function topAlerts(
  limit = 10,
): Promise<Array<{ key: string; coin: string; type: string; count: number }>> {
  const counts = (await kvGet<Record<string, number>>(ALERT_COUNTS)) ?? {};
  return Object.entries(counts)
    .map(([key, count]) => {
      const [coin, type] = key.split(":");
      return { key, coin: coin ?? "?", type: type ?? "?", count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function enqueueAlert(item: QueuedAlert): Promise<void> {
  const q = (await kvGet<QueuedAlert[]>(queueKey(item.user_id))) ?? [];
  q.push(item);
  await kvSet(queueKey(item.user_id), q);
  const idx = (await kvGet<number[]>(QUEUE_INDEX)) ?? [];
  if (!idx.includes(item.user_id)) {
    idx.push(item.user_id);
    await kvSet(QUEUE_INDEX, idx);
  }
}

export async function getQueuedAlerts(userId: number): Promise<QueuedAlert[]> {
  return (await kvGet<QueuedAlert[]>(queueKey(userId))) ?? [];
}

export async function setQueuedAlerts(
  userId: number,
  items: QueuedAlert[],
): Promise<void> {
  if (items.length === 0) {
    await kvSet(queueKey(userId), []);
    const idx = ((await kvGet<number[]>(QUEUE_INDEX)) ?? []).filter((id) => id !== userId);
    await kvSet(QUEUE_INDEX, idx);
    return;
  }
  await kvSet(queueKey(userId), items);
}

export async function listQueuedUserIds(): Promise<number[]> {
  return (await kvGet<number[]>(QUEUE_INDEX)) ?? [];
}

export async function setSummaryIndex(
  telegramId: number,
  enabled: boolean,
): Promise<void> {
  const idx = (await kvGet<number[]>(SUMMARY_INDEX)) ?? [];
  const has = idx.includes(telegramId);
  if (enabled && !has) {
    idx.push(telegramId);
    await kvSet(SUMMARY_INDEX, idx);
  } else if (!enabled && has) {
    await kvSet(
      SUMMARY_INDEX,
      idx.filter((id) => id !== telegramId),
    );
  }
}

export async function listSummaryUserIds(): Promise<number[]> {
  return (await kvGet<number[]>(SUMMARY_INDEX)) ?? [];
}
