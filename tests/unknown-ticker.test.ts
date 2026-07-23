import { describe, it, expect, beforeEach } from "vitest";
import { buildBot } from "../src/bot.js";
import { resetMemoryKv } from "../src/lib/kv.js";
import { setPriceClient, type PriceClient } from "../src/lib/prices.js";

const FAKE_BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: "TestBot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as const;

describe("unknown ticker handling", () => {
  beforeEach(() => {
    process.env.AGNTDEV_TEST = "1";
    process.env.NODE_ENV = "test";
    resetMemoryKv();
    setPriceClient({
      async fetchPrices() {
        return new Map();
      },
      async resolveId() {
        return null;
      },
    } satisfies PriceClient);
  });

  it("suggests popular coins when search finds nothing", async () => {
    const bot = await buildBot("test-token");
    (bot as unknown as { botInfo: typeof FAKE_BOT_INFO }).botInfo = FAKE_BOT_INFO;
    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: (payload ?? {}) as Record<string, unknown> });
      return { ok: true, result: true } as never;
    });

    // Enter add-coin flow
    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: "1",
        from: { id: 1, is_bot: false, first_name: "U" },
        message: {
          message_id: 10,
          date: 0,
          chat: { id: 1, type: "private" },
          text: "x",
        },
        chat_instance: "1",
        data: "add_coin:start",
      },
    });
    calls.length = 0;

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 11,
        date: 0,
        chat: { id: 1, type: "private" },
        from: { id: 1, is_bot: false, first_name: "U" },
        text: "ZZZX",
      },
    });

    const reply = calls.find((c) => c.method === "sendMessage");
    expect(reply?.payload.text).toBe(
      'Couldn\'t find "ZZZX". Try BTC, ETH, TON, or check the spelling.',
    );
  });
});
