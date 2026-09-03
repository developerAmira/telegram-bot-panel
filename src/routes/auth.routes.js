// ═══════════════════════════════════════════════════════════════════
//  routes/auth.routes.js — ورود/خروج/اعتبارسنجی نشست ادمین
//  POST /api/auth/login   {password} → {token, expiresAt}
//  GET  /api/auth/session            → اعتبارسنجی توکن
//  POST /api/auth/logout             → حذف نشست
// ═══════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import {
  requireAuth, createSession, deleteSession,
  loginAllowed, loginFailed, loginSucceeded, safeEqual,
} from '../auth.js';

const r = new Hono();

// ── ورود ───────────────────────────────────────────────────────────
r.post('/login', async (c) => {
  const env = c.env;

  // رمز باید حتماً از Secrets تنظیم شده باشد
  if (!env.ADMIN_PASSWORD) {
    return c.json({ ok: false, error: 'server_not_configured' }, 500);
  }

  // محدودیت نرخ بر اساس IP (پشت Cloudflare همیشه هدر cf-connecting-ip موجود است)
  const ip = c.req.header('cf-connecting-ip') || 'local-dev';
  const rl = await loginAllowed(env, ip);
  if (!rl.allowed) {
    return c.json({ ok: false, error: 'rate_limited' }, 429);
  }

  let password = '';
  try { ({ password = '' } = await c.req.json()); } catch { /* بدنه نامعتبر */ }

  const valid = await safeEqual(String(password), env.ADMIN_PASSWORD);
  if (!valid) {
    await loginFailed(env, ip);
    return c.json({ ok: false, error: 'invalid_credentials' }, 401);
  }

  await loginSucceeded(env, ip);
  const session = await createSession(env);
  return c.json({ ok: true, data: session });
});

// ── اعتبارسنجی نشست (برای ورود خودکار هنگام باز شدن پنل) ──────────
r.get('/session', requireAuth, (c) =>
  c.json({ ok: true, data: { valid: true, expiresAt: c.get('session').expiresAt } })
);

// ── خروج ───────────────────────────────────────────────────────────
r.post('/logout', requireAuth, async (c) => {
  await deleteSession(c.env, c.get('token'));
  return c.json({ ok: true, data: { loggedOut: true } });
});

export default r;
