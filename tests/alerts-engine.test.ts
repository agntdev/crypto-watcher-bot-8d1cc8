/**
 * Required behavioral tests that need a mocked price feed + injectable clock:
 * alert delivery with cooldown, quiet-hours suppression/queue, morning summary.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { resetMemoryKv } from "../src/lib/kv.js";
import { setNow, resetNow } from "../src/lib/clock.js";
import { setPriceClient, type PriceClient } from "../src/lib/prices.js";
import {
  addAlertRule,
  addWatchlistItem,
  ensureUser,
  getQueuedAlerts,
  getUser,
  saveUser,
  setSummaryIndex,
} from "../src/lib/users.js";
import {
  deliverAlert,
  evaluateRule,
  flushQueuedAlerts,
  runAlertPass,
  type FiredAlert,
} from "../src/lib/alerts.js";
import { isInQuietHours } from "../src/lib/quiet-hours.js";
import { runMorningSummaries } from "../src/lib/summary.js";
import { ALERT_COOLDOWN_MS } from "../src/lib/models.js";

function mockPrices(map: Record<string, number>): PriceClient {
  return {
    async fetchPrices(ids) {
      const out = new Map<string, { usd: number; change_24h?: number }>();
      for (const id of ids) {
        // Map coingecko ids used in tests
        const byId: Record<string, number> = {
          bitcoin: map.BTC ?? map.bitcoin ?? 0,
          ethereum: map.ETH ?? map.ethereum ?? 0,
          ...Object.fromEntries(
            Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]),
          ),
        };
        const usd = byId[id];
        if (usd !== undefined) out.set(id, { usd, change_24h: 1.5 });
      }
      return out;
    },
    async resolveId(ticker) {
      const t = ticker.toUpperCase();
      if (t === "BTC") return "bitcoin";
      if (t === "ETH") return "ethereum";
      return t.toLowerCase();
    },
  };
}

describe("alert engine", () => {
  beforeEach(() => {
    resetMemoryKv();
    resetNow();
    setPriceClient(null);
  });

  it("fires threshold alert when price crosses above", async () => {
    setNow(1_700_000_000_000);
    const user = await ensureUser(42);
    await addWatchlistItem(42, {
      ticker: "BTC",
      display_name: "Bitcoin",
      coingecko_id: "bitcoin",
    });
    user.last_seen_prices.BTC = 60_000;
    await saveUser(user);
    const rule = await addAlertRule(42, {
      coin_ticker: "BTC",
      alert_type: "threshold",
      threshold_price: 65_000,
      direction: "above",
    });
    const refreshed = (await getUser(42))!;
    const fired = evaluateRule(
      refreshed,
      refreshed.alert_rules.find((r) => r.id === rule.id)!,
      { ticker: "BTC", coingecko_id: "bitcoin", usd: 66_000 },
    );
    expect(fired).not.toBeNull();
    expect(fired!.new_price).toBe(66_000);
  });

  it("respects 1-hour cooldown", async () => {
    const t0 = 1_700_000_000_000;
    setNow(t0);
    await ensureUser(7);
    await addWatchlistItem(7, {
      ticker: "BTC",
      display_name: "Bitcoin",
      coingecko_id: "bitcoin",
    });
    const u = (await getUser(7))!;
    u.last_seen_prices.BTC = 60_000;
    await saveUser(u);
    const rule = await addAlertRule(7, {
      coin_ticker: "BTC",
      alert_type: "threshold",
      threshold_price: 65_000,
      direction: "above",
      last_alert_time: t0,
    });
    const user = (await getUser(7))!;
    const r = user.alert_rules.find((x) => x.id === rule.id)!;
    // Still within cooldown
    setNow(t0 + ALERT_COOLDOWN_MS - 1000);
    user.last_seen_prices.BTC = 60_000;
    expect(
      evaluateRule(user, r, {
        ticker: "BTC",
        coingecko_id: "bitcoin",
        usd: 70_000,
      }),
    ).toBeNull();
    // After cooldown
    setNow(t0 + ALERT_COOLDOWN_MS + 1);
    user.last_seen_prices.BTC = 60_000;
    expect(
      evaluateRule(user, r, {
        ticker: "BTC",
        coingecko_id: "bitcoin",
        usd: 70_000,
      }),
    ).not.toBeNull();
  });

  it("queues alerts during quiet hours", async () => {
    // 23:00 UTC — inside default 22:00–07:00 quiet hours
    const quietTime = Date.UTC(2024, 0, 1, 23, 0, 0);
    setNow(quietTime);
    const user = await ensureUser(9);
    user.quiet_hours = { start: "22:00", end: "07:00", enabled: true };
    user.timezone_offset_minutes = 0;
    await saveUser(user);

    expect(isInQuietHours(quietTime, user.quiet_hours, 0)).toBe(true);

    const fired: FiredAlert = {
      user: (await getUser(9))!,
      rule: {
        id: "al_test",
        coin_ticker: "BTC",
        alert_type: "threshold",
        threshold_price: 65_000,
        direction: "above",
      },
      old_price: 60_000,
      new_price: 66_000,
      message: "test alert",
    };
    const sent: string[] = [];
    const result = await deliverAlert(fired, async (_id, text) => {
      sent.push(text);
    }, quietTime);
    expect(result).toBe("queued");
    expect(sent).toHaveLength(0);
    const q = await getQueuedAlerts(9);
    expect(q).toHaveLength(1);
    expect(q[0]!.message).toBe("test alert");
  });

  it("flushes queued alerts after quiet hours when still valid", async () => {
    const quietTime = Date.UTC(2024, 0, 1, 23, 0, 0);
    setNow(quietTime);
    setPriceClient(mockPrices({ BTC: 66_000 }));

    await ensureUser(11);
    await addWatchlistItem(11, {
      ticker: "BTC",
      display_name: "Bitcoin",
      coingecko_id: "bitcoin",
    });
    const rule = await addAlertRule(11, {
      coin_ticker: "BTC",
      alert_type: "threshold",
      threshold_price: 65_000,
      direction: "above",
    });
    const user = (await getUser(11))!;
    user.quiet_hours = { start: "22:00", end: "07:00", enabled: true };
    await saveUser(user);

    await deliverAlert(
      {
        user: (await getUser(11))!,
        rule: { ...rule },
        old_price: 60_000,
        new_price: 66_000,
        message: "queued msg",
      },
      async () => {
        /* should not send */
      },
      quietTime,
    );
    expect(await getQueuedAlerts(11)).toHaveLength(1);

    // Morning — quiet hours ended
    const morning = Date.UTC(2024, 0, 2, 8, 0, 0);
    setNow(morning);
    setPriceClient(mockPrices({ BTC: 67_000 })); // still above threshold
    const out: string[] = [];
    const n = await flushQueuedAlerts(async (_id, text) => {
      out.push(text);
    });
    expect(n).toBe(1);
    expect(out.length).toBe(1);
    expect(await getQueuedAlerts(11)).toHaveLength(0);
  });

  it("drops stale queued alerts when condition no longer holds", async () => {
    const quietTime = Date.UTC(2024, 0, 1, 23, 0, 0);
    setNow(quietTime);
    await ensureUser(12);
    await addWatchlistItem(12, {
      ticker: "BTC",
      display_name: "Bitcoin",
      coingecko_id: "bitcoin",
    });
    const rule = await addAlertRule(12, {
      coin_ticker: "BTC",
      alert_type: "threshold",
      threshold_price: 65_000,
      direction: "above",
    });
    const user = (await getUser(12))!;
    user.quiet_hours = { start: "22:00", end: "07:00", enabled: true };
    await saveUser(user);
    await deliverAlert(
      {
        user: (await getUser(12))!,
        rule: { ...rule },
        old_price: 60_000,
        new_price: 66_000,
        message: "stale candidate",
      },
      async () => {},
      quietTime,
    );

    setNow(Date.UTC(2024, 0, 2, 8, 0, 0));
    setPriceClient(mockPrices({ BTC: 50_000 })); // back below threshold
    const out: string[] = [];
    const n = await flushQueuedAlerts(async (_id, text) => {
      out.push(text);
    });
    expect(n).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("runAlertPass delivers when not quiet", async () => {
    // Noon UTC — outside quiet hours
    setNow(Date.UTC(2024, 0, 1, 12, 0, 0));
    setPriceClient(mockPrices({ BTC: 70_000 }));
    await ensureUser(15);
    await addWatchlistItem(15, {
      ticker: "BTC",
      display_name: "Bitcoin",
      coingecko_id: "bitcoin",
    });
    const u = (await getUser(15))!;
    u.quiet_hours = { start: "22:00", end: "07:00", enabled: true };
    u.last_seen_prices.BTC = 60_000;
    await saveUser(u);
    await addAlertRule(15, {
      coin_ticker: "BTC",
      alert_type: "threshold",
      threshold_price: 65_000,
      direction: "above",
    });

    const out: Array<{ id: number; text: string }> = [];
    const n = await runAlertPass(async (id, text) => {
      out.push({ id, text });
    });
    expect(n).toBeGreaterThanOrEqual(1);
    expect(out.some((m) => m.id === 15 && m.text.includes("BTC"))).toBe(true);
  });
});

describe("morning summary scheduling", () => {
  beforeEach(() => {
    resetMemoryKv();
    resetNow();
    setPriceClient(mockPrices({ BTC: 42_000, ETH: 2_200 }));
  });

  it("sends summary at configured local time once per day", async () => {
    // 08:00 UTC
    setNow(Date.UTC(2024, 5, 10, 8, 0, 0));
    await ensureUser(20);
    await addWatchlistItem(20, {
      ticker: "BTC",
      display_name: "Bitcoin",
      coingecko_id: "bitcoin",
    });
    const u = (await getUser(20))!;
    u.summary_enabled = true;
    u.summary_time = "08:00";
    u.timezone_offset_minutes = 0;
    await saveUser(u);
    await setSummaryIndex(20, true);

    const out: string[] = [];
    const n1 = await runMorningSummaries(async (_id, text) => {
      out.push(text);
    });
    expect(n1).toBe(1);
    expect(out[0]).toContain("Morning summary");
    expect(out[0]).toContain("BTC");

    // Same minute again — already sent today
    const n2 = await runMorningSummaries(async (_id, text) => {
      out.push(text);
    });
    expect(n2).toBe(0);
    expect(out).toHaveLength(1);
  });

  it("does not send when disabled", async () => {
    setNow(Date.UTC(2024, 5, 10, 8, 0, 0));
    await ensureUser(21);
    const u = (await getUser(21))!;
    u.summary_enabled = false;
    u.summary_time = "08:00";
    await saveUser(u);
    await setSummaryIndex(21, false);
    const n = await runMorningSummaries(async () => {});
    expect(n).toBe(0);
  });
});

describe("quiet hours helper", () => {
  it("handles overnight window", () => {
    const q = { start: "22:00", end: "07:00", enabled: true };
    expect(isInQuietHours(Date.UTC(2024, 0, 1, 23, 0, 0), q, 0)).toBe(true);
    expect(isInQuietHours(Date.UTC(2024, 0, 1, 3, 0, 0), q, 0)).toBe(true);
    expect(isInQuietHours(Date.UTC(2024, 0, 1, 12, 0, 0), q, 0)).toBe(false);
  });

  it("respects disabled flag", () => {
    const q = { start: "22:00", end: "07:00", enabled: false };
    expect(isInQuietHours(Date.UTC(2024, 0, 1, 23, 0, 0), q, 0)).toBe(false);
  });
});
