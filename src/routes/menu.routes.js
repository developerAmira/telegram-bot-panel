// ═══════════════════════════════════════════════════════════════════
//  routes/menu.routes.js — سازنده منو و دکمه‌های شیشه‌ای
//  GET  /api/menu          → منوی فعلی + پیش‌فرض‌ها
//  PUT  /api/menu          → ذخیره منو (اعتبارسنجی کامل)
//  POST /api/menu/preview  → ارسال پیش‌نمایش /start به یک چت {chatId}
// ═══════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { DEFAULT_MENU, getMenu, saveMenu } from '../kv.js';
import { resolveToken, sendStart } from '../telegram.js';

const r = new Hono();
r.use('*', requireAuth);

const fail = (c, error, status = 400) => c.json({ ok: false, error }, status);

// ── اعتبارسنجی و پاک‌سازی ورودی منو ────────────────────────────────
function sanitizeMenu(input = {}) {
  const clean = (s, max) => String(s ?? '').trim().slice(0, max);

  const welcome = {
    fa: clean(input?.welcome?.fa, 3500) || DEFAULT_MENU.welcome.fa,
    en: clean(input?.welcome?.en, 3500) || DEFAULT_MENU.welcome.en,
  };
  const help = {
    fa: clean(input?.help?.fa, 3500) || DEFAULT_MENU.help.fa,
    en: clean(input?.help?.en, 3500) || DEFAULT_MENU.help.en,
  };

  // کیبورد اصلی: حداکثر ۱۲ ردیف × ۸ دکمه، متن ۱..۴۸ کاراکتر
  const mainKeyboard = [];
  if (Array.isArray(input?.mainKeyboard)) {
    for (const row of input.mainKeyboard.slice(0, 12)) {
      if (!Array.isArray(row)) continue;
      const texts = row
        .map((t) => clean(t, 48))
        .filter((t) => t.length >= 1);
      if (texts.length) mainKeyboard.push(texts.slice(0, 8));
    }
  }

  // دکمه‌های شیشه‌ای: حداکثر ۱۰ ردیف × ۸ دکمه
  // type: 'url' (لینک http/https) یا 'callback' (حداکثر ۶۴ بایت)
  const inlineButtons = [];
  if (Array.isArray(input?.inlineButtons)) {
    for (const row of input.inlineButtons.slice(0, 10)) {
      if (!Array.isArray(row)) continue;
      const btns = [];
      for (const b of row.slice(0, 8)) {
        const text = clean(b?.text, 64);
        const type = b?.type === 'url' ? 'url' : 'callback';
        const value = clean(b?.value, 512);
        if (!text) continue;
        if (type === 'url') {
          if (!/^https?:\/\//i.test(value)) continue;
          inlineOk(btns, { text, type, value: value.slice(0, 512) });
        } else {
          if (value.length < 1 || value.length > 64) continue;
          inlineOk(btns, { text, type, value });
        }
      }
      if (btns.length) inlineButtons.push(btns);
    }
  }

  if (!mainKeyboard.length) mainKeyboard.push(...JSON.parse(JSON.stringify(DEFAULT_MENU.mainKeyboard)));
  if (!inlineButtons.length) inlineButtons.push(...JSON.parse(JSON.stringify(DEFAULT_MENU.inlineButtons)));

  return { welcome, help, mainKeyboard, inlineButtons };
}

const inlineOk = (arr, b) => arr.push(b);

// ── خواندن منو ─────────────────────────────────────────────────────
r.get('/', async (c) =>
  c.json({ ok: true, data: { menu: await getMenu(c.env), defaults: DEFAULT_MENU } })
);

// ── ذخیره منو ──────────────────────────────────────────────────────
r.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const menu = sanitizeMenu(body);
  await saveMenu(c.env, menu);
  return c.json({ ok: true, data: { menu } });
});

// ── ارسال پیش‌نمایش به چت ادمین ────────────────────────────────────
r.post('/preview', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const chatId = Number(body.chatId);
  if (!Number.isInteger(chatId) || chatId <= 0) return fail(c, 'invalid_chat_id');

  const token = await resolveToken(c.env);
  if (!token) return fail(c, 'token_missing');

  const menu = await getMenu(c.env);
  try {
    // پیش‌نمایش دقیقاً مثل /start واقعی: خوش‌آمد + دکمه‌ها + کیبورد اصلی
    await sendStart(token, chatId, { id: chatId, firstName: 'Admin' }, menu, 'fa');
    return c.json({ ok: true, data: { sent: true } });
  } catch (e) {
    return fail(c, 'telegram_error');
  }
});

export default r;
