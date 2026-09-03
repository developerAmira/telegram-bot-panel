// ═══════════════════════════════════════════════════════════════════
//  routes/settings.routes.js — مدیریت تنظیمات و کانفیگ
//  GET  /api/settings           → تنظیمات (توکن ماسک‌شده!)
//  PUT  /api/settings           → بروزرسانی (توکن/ادمین‌ها/زبان/تیونینگ)
//  POST /api/settings/webhook   → {action:'set'|'delete'} تنظیم/حذف وب‌هوک
// ═══════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { getSettings, saveSettings } from '../kv.js';
import { resolveToken, tgApi } from '../telegram.js';

const r = new Hono();
r.use('*', requireAuth);

const fail = (c, error, status = 400) => c.json({ ok: false, error }, status);

// فقط ۴ کاراکتر آخر توکن نمایش داده می‌شود (جلوگیری از نشت)
function publicView(settings, envToken) {
  const token = settings.botToken || envToken || '';
  return {
    hasToken: !!token,
    tokenMasked: token ? `${'•'.repeat(8)}${token.slice(-4)}` : '',
    source: settings.botToken ? 'kv' : envToken ? 'env' : 'none',
    defaultLang: settings.defaultLang,
    botLangMode: settings.botLangMode || 'both',
    supportButton: settings.supportButton,
    broadcast: settings.broadcast,
    requiredChannel: settings.requiredChannel,
  };
}

// ── خواندن تنظیمات ─────────────────────────────────────────────────
r.get('/', async (c) => {
  const settings = await getSettings(c.env);
  return c.json({ ok: true, data: { settings: publicView(settings, c.env.BOT_TOKEN) } });
});

// ── بروزرسانی تنظیمات ──────────────────────────────────────────────
r.put('/', async (c) => {
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));
  const settings = await getSettings(env);

  // توکن ربات — فقط اگر مقدار غیرخالی فرستاده شود جایگزین می‌شود
  if (typeof body.botToken === 'string' && body.botToken.trim()) {
    settings.botToken = body.botToken.trim();
  }

  if (['fa', 'en'].includes(body.defaultLang)) settings.defaultLang = body.defaultLang;

  // ── حالت زبان ربات: دوزبانه یا تک‌زبانه ──────────────────
  if (['fa', 'en', 'both'].includes(body.botLangMode)) settings.botLangMode = body.botLangMode;

  // ── دکمه پشتیبانی همیشگی (افزودن خودکار به همه صفحات منو) ──
  if (body.supportButton && typeof body.supportButton === 'object') {
    const sb = body.supportButton;
    settings.supportButton = {
      enabled: !!sb.enabled,
      fa: String(sb.fa || '').trim().slice(0, 64) || '🛡 پشتیبانی',
      en: String(sb.en || '').trim().slice(0, 64) || '🛡 Support',
    };
  }

  // ── قفل کانال (عضویت اجباری) ─────────────────────────────
  if (body.requiredChannel && typeof body.requiredChannel === 'object') {
    const rc = body.requiredChannel;
    settings.requiredChannel = {
      enabled: !!rc.enabled,
      chatId: String(rc.chatId || '').trim().slice(0, 64),
      url: /^https?:\/\//i.test(String(rc.url || '')) ? String(rc.url).trim().slice(0, 512) : '',
    };
  }

  if (body.broadcast && typeof body.broadcast === 'object') {
    const bs = Number(body.broadcast.batchSize);
    const dm = Number(body.broadcast.delayMs);
    if (Number.isFinite(bs)) settings.broadcast.batchSize = Math.min(Math.max(bs, 1), 50);
    if (Number.isFinite(dm)) settings.broadcast.delayMs = Math.min(Math.max(dm, 20), 500);
  }

  await saveSettings(env, settings);
  return c.json({ ok: true, data: { settings: publicView(settings, env.BOT_TOKEN) } });
});

// ── تنظیم/حذف وب‌هوک تلگرام ────────────────────────────────────────
r.post('/webhook', async (c) => {
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));
  const action = body.action === 'delete' ? 'delete' : 'set';

  const token = await resolveToken(env);
  if (!token) return fail(c, 'token_missing');

  let res;
  if (action === 'delete') {
    res = await tgApi(token, 'deleteWebhook', { drop_pending_updates: false });
  } else {
    // وب‌هوک باید با secret token تنظیم شود تا جعل درخواست ناممکن باشد
    if (!env.WEBHOOK_SECRET) return fail(c, 'webhook_secret_missing');
    const url = `${new URL(c.req.url).origin}/telegram/webhook`;
    res = await tgApi(token, 'setWebhook', {
      url,
      secret_token: env.WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    if (res.ok) return c.json({ ok: true, data: { url, result: res.result } });
  }

  if (!res.ok) return fail(c, res.description || 'telegram_error');
  return c.json({ ok: true, data: { result: res.result } });
});

export default r;
