import { buildBot } from "./bot.js";
import { resetMemoryKv } from "./lib/kv.js";
import { resetNow } from "./lib/clock.js";
import { setPriceClient, setFetch } from "./lib/prices.js";

// The Tests-gate harness imports THIS module and calls makeBot() with no args,
// replaying dialog specs tokenlessly (it fakes the Bot API transport — no real
// Telegram call is made). The token is a placeholder for replay. The agntdev-ci
// orchestrator points AGNTDEV_BOT_MODULE at the compiled dist/harness-entry.js.
export async function makeBot() {
  // Isolate durable state + clock between specs.
  resetMemoryKv();
  resetNow();
  setPriceClient(null);
  setFetch(null);
  if (typeof process !== "undefined") {
    process.env.AGNTDEV_TEST = "1";
  }
  return buildBot(process.env.BOT_TOKEN ?? "harness-test-token");
}
