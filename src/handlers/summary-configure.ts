import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { parseHm } from "../lib/clock.js";
import {
  ensureUser,
  saveUser,
  setSummaryIndex,
} from "../lib/users.js";
import { COPY } from "../lib/ui.js";

registerMainMenuItem({
  label: "Morning Summary",
  data: "summary:configure",
  order: 40,
});

const composer = new Composer<Ctx>();

function statusText(
  enabled: boolean,
  time: string | null,
  offset: number,
): string {
  if (!enabled || !time) {
    return (
      "Morning summary is off (opt-in).\n\n" +
      "When enabled, you'll get a daily digest of your watchlist at the local time you choose."
    );
  }
  const off =
    offset === 0
      ? "UTC"
      : `UTC${offset >= 0 ? "+" : ""}${offset / 60}`;
  return (
    `Morning summary is on at ${time} (${off}).\n\n` +
    "You'll get a daily digest of your watchlist prices. Not financial advice."
  );
}

function mainKeyboard(enabled: boolean) {
  return inlineKeyboard([
    [
      inlineButton(
        enabled ? "Disable" : "Enable",
        enabled ? "summary:disable" : "summary:enable",
      ),
      inlineButton("Set time", "summary:set_time"),
    ],
    [
      inlineButton("UTC", "summary:tz:0"),
      inlineButton("UTC+1", "summary:tz:60"),
      inlineButton("UTC-5", "summary:tz:-300"),
    ],
    [
      inlineButton("UTC+3", "summary:tz:180"),
      inlineButton("UTC+8", "summary:tz:480"),
      inlineButton("UTC+9", "summary:tz:540"),
    ],
    [inlineButton("Back to menu", "menu:main")],
  ]);
}

composer.callbackQuery("summary:configure", async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from?.id;
  if (!uid) return;
  const user = await ensureUser(uid);
  ctx.session.step = "idle";
  const text = statusText(
    user.summary_enabled,
    user.summary_time,
    user.timezone_offset_minutes,
  );
  try {
    await ctx.editMessageText(text, {
      reply_markup: mainKeyboard(user.summary_enabled),
    });
  } catch {
    await ctx.reply(text, { reply_markup: mainKeyboard(user.summary_enabled) });
  }
});

composer.callbackQuery("summary:enable", async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from?.id;
  if (!uid) return;
  const user = await ensureUser(uid);
  user.summary_enabled = true;
  if (!user.summary_time) user.summary_time = "08:00";
  await saveUser(user);
  await setSummaryIndex(uid, true);
  const text = statusText(true, user.summary_time, user.timezone_offset_minutes);
  try {
    await ctx.editMessageText(text, { reply_markup: mainKeyboard(true) });
  } catch {
    await ctx.reply(text, { reply_markup: mainKeyboard(true) });
  }
});

composer.callbackQuery("summary:disable", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Summary off" });
  const uid = ctx.from?.id;
  if (!uid) return;
  const user = await ensureUser(uid);
  user.summary_enabled = false;
  await saveUser(user);
  await setSummaryIndex(uid, false);
  const text = statusText(false, user.summary_time, user.timezone_offset_minutes);
  try {
    await ctx.editMessageText(text, { reply_markup: mainKeyboard(false) });
  } catch {
    await ctx.reply(text, { reply_markup: mainKeyboard(false) });
  }
});

composer.callbackQuery("summary:set_time", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_summary_time";
  const text =
    "Send the local time for your morning summary as HH:mm (e.g. 08:00).";
  try {
    await ctx.editMessageText(text, {
      reply_markup: inlineKeyboard([
        [inlineButton("Cancel", "summary:configure")],
      ]),
    });
  } catch {
    await ctx.reply(text, {
      reply_markup: inlineKeyboard([
        [inlineButton("Cancel", "summary:configure")],
      ]),
    });
  }
});

composer.callbackQuery(/^summary:tz:(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Timezone saved" });
  const uid = ctx.from?.id;
  if (!uid) return;
  const offset = Number(ctx.match![1]);
  const user = await ensureUser(uid);
  user.timezone_offset_minutes = offset;
  await saveUser(user);
  const text = statusText(
    user.summary_enabled,
    user.summary_time,
    user.timezone_offset_minutes,
  );
  try {
    await ctx.editMessageText(text, {
      reply_markup: mainKeyboard(user.summary_enabled),
    });
  } catch {
    await ctx.reply(text, { reply_markup: mainKeyboard(user.summary_enabled) });
  }
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_summary_time") return next();
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next();
  if (text.toLowerCase() === "cancel") {
    ctx.session.step = "idle";
    await ctx.reply(COPY.cancel);
    return;
  }
  const parsed = parseHm(text);
  if (!parsed) {
    await ctx.reply("Use HH:mm, like 08:00.");
    return;
  }
  const hm = `${parsed.hours.toString().padStart(2, "0")}:${parsed.minutes
    .toString()
    .padStart(2, "0")}`;
  const uid = ctx.from?.id;
  if (!uid) return;
  const user = await ensureUser(uid);
  user.summary_time = hm;
  user.summary_enabled = true;
  await saveUser(user);
  await setSummaryIndex(uid, true);
  ctx.session.step = "idle";
  await ctx.reply(
    `Morning summary set for ${hm} (your selected timezone). You're opted in.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Morning Summary", "summary:configure")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    },
  );
});

export default composer;
