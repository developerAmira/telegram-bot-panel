// ═══════════════════════════════════════════════════════════════════
//  telegram.js — کلاینت Bot API تلگرام + منطق پردازش آپدیت‌ها (وب‌هوک)
//
//  ▪ tgApi()      : فراخوانی متدهای Bot API (sendMessage، setWebhook و…)
//  ▪ handleUpdate : نقطه ورود وب‌هوک (پیام‌ها و callback_query ها)
//  ▪ touchUser    : ثبت/به‌روزرسانی کاربر با کاهش نوشتن‌های KV
//  دستورات ربات: /start /help /lang /id /ping
// ═══════════════════════════════════════════════════════════════════

import {
  getMenu, getSettings, getUser, putUser, bumpStats, pushRecentUser,
} from './kv.js';

// ── متن‌های داخلی ربات (welcome/help از پنل قابل ویرایش‌اند) ────────
const BOT_T = {
  fa: {
    chooseLang: '🌍 زبان خود را انتخاب کنید:',
    unknown: '🤔 متوجه نشدم. برای دیدن راهنما /help را بزنید.',
    langSet: '✅ زبان به فارسی تغییر کرد.',
    yourId: '🆔 آیدی عددی شما:',
    kbHint: '⬇️ منوی اصلی فعال شد',
    pong: '🏓 پونگ! ربات فعال است.',
  },
  en: {
    chooseLang: '🌍 Please choose your language:',
    unknown: "🤔 I didn't understand. Send /help for usage.",
    langSet: '✅ Language changed to English.',
    yourId: '🆔 Your numeric ID:',
    kbHint: '⬇️ Main menu is now active',
    pong: '🏓 Pong! The bot is alive.',
  },
};

// توکن ربات: اول از تنظیمات KV، بعد از متغیر محیطی
export async function resolveToken(env) {
  const s = await getSettings(env);
  return s.botToken || env.BOT_TOKEN || null;
}

// ── فراخوانی Bot API — همیشه {ok, result?, description?} برمی‌گرداند ──
export async function tgApi(token, method, payload = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json().catch(() => ({
      ok: false, error_code: res.status, description: 'Invalid JSON response',
    }));
  } catch (e) {
    return { ok: false, error_code: 0, description: String((e && e.message) || e) };
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// برای جلوگیری از قفل‌شدن داشبورد وقتی تلگرام پاسخ نمی‌دهد
export function withTimeout(promise, ms, fallback = null) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

// ── ساخت مارک‌آپ‌ها ────────────────────────────────────────────────

export function renderTpl(text = '', user = {}) {
  return String(text)
    .replace(/\{name\}/g, user.firstName || '')
    .replace(/\{username\}/g, user.username ? `@${user.username}` : '')
    .replace(/\{id\}/g, String(user.id || ''));
}

export function mainKeyboardMarkup(menu) {
  return {
    keyboard: menu.mainKeyboard.map((row) => row.map((t) => ({ text: t }))),
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function inlineMarkup(menu) {
  return {
    inline_keyboard: menu.inlineButtons.map((row) =>
      row.map((b) =>
        b.type === 'url'
          ? { text: b.text, url: b.value }
          : { text: b.text, callback_data: String(b.value || 'noop').slice(0, 64) }
      )
    ),
  };
}

export function sendToUser(token, chatId, text, extra = {}) {
  return tgApi(token, 'sendMessage', { chat_id: chatId, text, ...extra });
}

// ── ثبت/به‌روزرسانی کاربر ──────────────────────────────────────────
// برای کاهش هزینه نوشتن KV، فقط در صورت تغییر نام یا هر ۵ دقیقه یک‌بار write می‌کنیم
export async function touchUser(env, from) {
  const now = Date.now();
  const existing = await getUser(env, from.id);
  if (!existing) {
    const user = {
      id: from.id,
      firstName: from.first_name || '',
      username: from.username || '',
      lang: '',
      joinedAt: now,
      lastSeen: now,
      banned: false,
      bannedAt: 0,
      banReason: '',
      blockedBot: false,
    };
    await putUser(env, user);
    await bumpStats(env, { users: 1 });
    await pushRecentUser(env, user.id);
    return { user, isNew: true };
  }
  const firstName = from.first_name || existing.firstName;
  const username = from.username || existing.username;
  const changed = firstName !== existing.firstName || username !== existing.username;
  if (changed || now - (existing.lastSeen || 0) > 5 * 60 * 1000) {
    existing.firstName = firstName;
    existing.username = username;
    existing.lastSeen = now;
    await putUser(env, existing);
  }
  return { user: existing, isNew: false };
}

// ═══════════════ پردازش آپدیت وب‌هوک ═══════════════

export async function handleUpdate(env, update) {
  try {
    if (update.message) return await onMessage(env, update.message);
    if (update.callback_query) return await onCallback(env, update.callback_query);
  } catch (e) {
    console.error('[webhook] update error:', e);
  }
}

async function onMessage(env, msg) {
  const from = msg.from;
  if (!from || from.is_bot) return;

  const token = await resolveToken(env);
  if (!token) return; // ربات هنوز پیکربندی نشده

  const settings = await getSettings(env);
  const { user } = await touchUser(env, from);
  if (user.banned) return; // کاربر مسدود — بی‌خیال

  bumpStats(env, { messages: 1 }); // fire-and-forget (نیازی به await نیست)

  const text = String(msg.text || '').trim();
  if (!text) return;

  const lang = BOT_T[user.lang || settings.defaultLang] ? (user.lang || settings.defaultLang) : 'fa';
  const T = BOT_T[lang];
  const menu = await getMenu(env);
  const chatId = msg.chat.id;

  // ── دستورات ──────────────────────────────────────────────
  if (text.startsWith('/')) {
    const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();
    switch (cmd) {
      case '/start':
        return await sendStart(token, chatId, user, menu, lang);
      case '/help':
        return await sendToUser(token, chatId, renderTpl(menu.help[lang] || menu.help.fa, user), {
          reply_markup: mainKeyboardMarkup(menu),
          disable_web_page_preview: true,
        });
      case '/lang':
        return await sendToUser(token, chatId, T.chooseLang, { reply_markup: langKeyboard() });
      case '/id':
        return await sendToUser(token, chatId, `${T.yourId} <code>${user.id}</code>`, {
          parse_mode: 'HTML',
          reply_markup: mainKeyboardMarkup(menu),
        });
      case '/ping':
        return await sendToUser(token, chatId, T.pong);
      default:
        return await sendToUser(token, chatId, T.unknown, {
          reply_markup: mainKeyboardMarkup(menu),
        });
    }
  }

  // متن عادی — پاسخ پیش‌فرض قالب (اینجا منطق اختصاصی ربات خود را بگذارید)
  return await sendToUser(token, chatId, T.unknown, { reply_markup: mainKeyboardMarkup(menu) });
}

// ارسال نمای /start: پیام خوش‌آمد + دکمه‌های شیشه‌ای، سپس فعال‌سازی کیبورد اصلی
// (تلگرام اجازه نمی‌دهد reply-keyboard و inline-keyboard در یک پیام باشند)
export async function sendStart(token, chatId, user, menu, lang) {
  const T = BOT_T[lang] || BOT_T.fa;
  const welcome = renderTpl(menu.welcome[lang] || menu.welcome.fa, user);
  await sendToUser(token, chatId, welcome, {
    reply_markup: inlineMarkup(menu),
    disable_web_page_preview: true,
  });
  if (menu.mainKeyboard.length) {
    await sendToUser(token, chatId, T.kbHint, { reply_markup: mainKeyboardMarkup(menu) });
  }
}

function langKeyboard() {
  return {
    inline_keyboard: [[
      { text: 'فارسی 🇮🇷', callback_data: 'setlang:fa' },
      { text: 'English 🇬🇧', callback_data: 'setlang:en' },
    ]],
  };
}

async function onCallback(env, cb) {
  const from = cb.from;
  const token = await resolveToken(env);
  if (!token) return;

  const user = await getUser(env, from.id);
  if (!user || user.banned) return;
  user.lastSeen = Date.now();

  const data = String(cb.data || '');
  const answer = (text) =>
    tgApi(token, 'answerCallbackQuery', { callback_query_id: cb.id, text });

  // ── تغییر زبان ───────────────────────────────────────────
  if (data === 'setlang:menu') {
    await sendToUser(token, cb.message.chat.id, BOT_T[user.lang || 'fa'].chooseLang, {
      reply_markup: langKeyboard(),
    });
    return answer();
  }
  if (data === 'setlang:fa' || data === 'setlang:en') {
    const lang = data.slice(8);
    user.lang = lang;
    await putUser(env, user);
    const T = BOT_T[lang];
    const menu = await getMenu(env);
    // ویرایش همان پیام به زبان جدید + نمایش مجدد منو
    await tgApi(token, 'editMessageText', {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: `${T.langSet}\n\n${renderTpl(menu.welcome[lang], user)}`,
      reply_markup: inlineMarkup(menu),
      disable_web_page_preview: true,
    });
    return answer(T.langSet);
  }

  // دکمه‌های callback سفارشی — منطق خود را اینجا اضافه کنید
  return answer();
}
