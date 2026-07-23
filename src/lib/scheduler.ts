/**
 * Background tick: alert evaluation, quiet-hours flush, morning summaries.
 * Started from the Node entry; safe no-op under the test harness.
 */

import type { Bot } from "grammy";
import { runAlertPass, flushQueuedAlerts } from "./alerts.js";
import { runMorningSummaries } from "./summary.js";

export type AnyBot = Bot<any>;

function makeSend(bot: AnyBot) {
  return async (chatId: number, text: string) => {
    await bot.api.sendMessage(chatId, text);
  };
}

/** One scheduler cycle. Exported for tests. */
export async function runSchedulerTick(bot: AnyBot): Promise<void> {
  const send = makeSend(bot);
  try {
    await runAlertPass(send);
  } catch (err) {
    console.error("[scheduler] alert pass failed:", err);
  }
  try {
    await flushQueuedAlerts(send);
  } catch (err) {
    console.error("[scheduler] queue flush failed:", err);
  }
  try {
    await runMorningSummaries(send);
  } catch (err) {
    console.error("[scheduler] morning summary failed:", err);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start a 60s interval. Idempotent. */
export function startScheduler(bot: AnyBot, intervalMs = 60_000): void {
  if (timer) return;
  // Delay first tick slightly so startup isn't blocked.
  timer = setInterval(() => {
    void runSchedulerTick(bot);
  }, intervalMs);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as NodeJS.Timeout).unref?.();
  }
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
