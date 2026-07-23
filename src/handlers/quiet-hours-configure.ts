import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { parseHm } from "../lib/clock.js";
import { DEFAULT_QUIET_HOURS } from "../lib/models.js";
import { ensureUser, saveUser } from "../lib/users.js";
import { COPY } from "../lib/ui.js";

registerMainMenuItem({
  label: "Set Quiet Hours",
  data: "quiet_hours:configure",
  order: 30,
});

const composer = new Composer<Ctx>();

function statusText(
  start: string,
  end: string,
  enabled: boolean,
): string {
  const state = enabled ? "on" : "off";
  return (
    `Quiet hours are ${state}: ${start}–${end} (your local time).\n\n` +
    "Alerts that fire during quiet hours are queued and sent when quiet hours end — " +
    "only if the condition still holds.\n\n" +
    "Tap a preset, turn them off, or set custom times."
  );
}

function mainKeyboard(enabled: boolean) {
  return inlineKeyboard([
    [
      inlineButton("22:00–07:00", "quiet_hours:preset:22:00:07:00"),
      inlineButton("23:00–08:00", "quiet_hours:preset:23:00:08:00"),
    ],
    [
      inlineButton(
        enabled ? "Turn off" : "Turn on",
        enabled ? "quiet_hours:disable" : "quiet_hours:enable",
      ),
      inlineButton("Custom times", "quiet_hours:custom"),
    ],
    [inlineButton("Back to menu", "menu:main")],
  ]);
}

composer.callbackQuery("quiet_hours:configure", async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from?.id;
  if (!uid) return;
  const user = await ensureUser(uid);
  ctx.session.step = "idle";
  const q = user.quiet_hours ?? { ...DEFAULT_QUIET_HOURS };
  const text = statusText(q.start, q.end, q.enabled);
  try {
    await ctx.editMessageText(text, { reply_markup: mainKeyboard(q.enabled) });
  } catch {
    await ctx.reply(text, { reply_markup: mainKeyboard(q.enabled) });
  }
});

composer.callbackQuery(/^quiet_hours:preset:(\d{2}:\d{2}):(\d{2}:\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Saved" });
  const uid = ctx.from?.id;
  if (!uid) return;
  const start = ctx.match![1]!;
  const end = ctx.match![2]!;
  const user = await ensureUser(uid);
  user.quiet_hours = { start, end, enabled: true };
  await saveUser(user);
  const text = `Quiet hours saved: ${start}–${end}. Alerts will pause in that window.`;
  try {
    await ctx.editMessageText(text, { reply_markup: mainKeyboard(true) });
  } catch {
    await ctx.reply(text, { reply_markup: mainKeyboard(true) });
  }
});

composer.callbackQuery("quiet_hours:disable", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Quiet hours off" });
  const uid = ctx.from?.id;
  if (!uid) return;
  const user = await ensureUser(uid);
  user.quiet_hours = { ...user.quiet_hours, enabled: false };
  await saveUser(user);
  const text = statusText(user.quiet_hours.start, user.quiet_hours.end, false);
  try {
    await ctx.editMessageText(text, { reply_markup: mainKeyboard(false) });
  } catch {
    await ctx.reply(text, { reply_markup: mainKeyboard(false) });
  }
});

composer.callbackQuery("quiet_hours:enable", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Quiet hours on" });
  const uid = ctx.from?.id;
  if (!uid) return;
  const user = await ensureUser(uid);
  user.quiet_hours = {
    start: user.quiet_hours?.start ?? DEFAULT_QUIET_HOURS.start,
    end: user.quiet_hours?.end ?? DEFAULT_QUIET_HOURS.end,
    enabled: true,
  };
  await saveUser(user);
  const text = statusText(user.quiet_hours.start, user.quiet_hours.end, true);
  try {
    await ctx.editMessageText(text, { reply_markup: mainKeyboard(true) });
  } catch {
    await ctx.reply(text, { reply_markup: mainKeyboard(true) });
  }
});

composer.callbackQuery("quiet_hours:custom", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_quiet_start";
  ctx.session.draft_quiet_start = undefined;
  const text =
    "Custom quiet hours.\n\nSend the start time as HH:mm (e.g. 22:00).";
  try {
    await ctx.editMessageText(text, {
      reply_markup: inlineKeyboard([
        [inlineButton("Cancel", "quiet_hours:configure")],
      ]),
    });
  } catch {
    await ctx.reply(text, {
      reply_markup: inlineKeyboard([
        [inlineButton("Cancel", "quiet_hours:configure")],
      ]),
    });
  }
});

composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step;
  if (step !== "awaiting_quiet_start" && step !== "awaiting_quiet_end") {
    return next();
  }
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next();
  if (text.toLowerCase() === "cancel") {
    ctx.session.step = "idle";
    await ctx.reply(COPY.cancel);
    return;
  }

  const parsed = parseHm(text);
  if (!parsed) {
    await ctx.reply("Use HH:mm, like 22:00.");
    return;
  }
  const hm = `${parsed.hours.toString().padStart(2, "0")}:${parsed.minutes
    .toString()
    .padStart(2, "0")}`;

  if (step === "awaiting_quiet_start") {
    ctx.session.draft_quiet_start = hm;
    ctx.session.step = "awaiting_quiet_end";
    await ctx.reply("Start saved. Send the end time as HH:mm (e.g. 07:00).");
    return;
  }

  const uid = ctx.from?.id;
  if (!uid) return;
  const start = ctx.session.draft_quiet_start ?? DEFAULT_QUIET_HOURS.start;
  const user = await ensureUser(uid);
  user.quiet_hours = { start, end: hm, enabled: true };
  await saveUser(user);
  ctx.session.step = "idle";
  ctx.session.draft_quiet_start = undefined;
  await ctx.reply(
    `Quiet hours saved: ${start}–${hm}. Alerts will pause in that window.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Set Quiet Hours", "quiet_hours:configure")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    },
  );
});

export default composer;
