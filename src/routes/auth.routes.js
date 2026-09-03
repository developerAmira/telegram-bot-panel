// ═══════════════════════════════════════════════════════════════════
//  routes/auth.routes.js — ورود/خروج/تغییر رمز ادمین
//
//  🔑 رمز پنل دیگر متغیر محیطی نیست:
//   • پیش‌فرض داخلی: botpanel123 (ثابت DEFAULT_ADMIN_PASSWORD در auth.js)
//   • تغییر رمز فقط از داخل پنل: POST /api/auth/change-password
//   • ذخیره به‌صورت هش SHA-256 در KV (کلید admin_auth)
//
//  POST /api/auth/login            {password} → {token, expiresAt}
//  GET  /api/auth/session                     → اعتبارسنجی توکن
//  POST /api/auth/logout                      → حذف نشست
//  GET  /api/auth/default-status              → آیا رمز پیش‌فرض هنوز فعال است؟ (عمومی)
//  POST /api/auth/change-password  {currentPassword, newPassword}
// ═══════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import {
  requireAuth, createSession, deleteSession, deleteAllSessions,
  loginAllowed, loginFailed, loginSucceeded,
  verifyAdminPassword, setAdminPassword, isDefaultPasswordActive,
} from '../auth.js';

const r = new Hono();

// ── ورود ───────────────────────────────────────────────────────────
r.post('/login', async (c) => {
  const env = c.env;

  // محدودیت نرخ بر اساس IP (پشت Cloudflare همیشه هدر cf-connecting-ip موجود است)
  const ip = c.req.header('cf-connecting-ip') || 'local-dev';
  const rl = await loginAllowed(env, ip);
  if (!rl.allowed) {
    return c.json({ ok: false, error: 'rate_limited' }, 429);
  }

  let password = '';
  try { ({ password = '' } = await c.req.json()); } catch { /* بدنه نامعتبر */ }

  // اعتبارسنجی با رمز ست‌شده در KV یا رمز پیش‌فرض
  const valid = await verifyAdminPassword(env, String(password));
  if (!valid) {
    await loginFailed(env, ip);
    return c.json({ ok: false, error: 'invalid_credentials' }, 401);
  }

  await loginSucceeded(env, ip);
  const session = await createSession(env);
  return c.json({ ok: true, data: session });
});

// ── وضعیت رمز پیش‌فرض (عمومی — فقط می‌گوید هنوز عوض نشده یا نه) ────
r.get('/default-status', async (c) =>
  c.json({ ok: true, data: { defaultActive: await isDefaultPasswordActive(c.env) } })
);

// ── اعتبارسنجی نشست (برای ورود خودکار هنگام باز شدن پنل) ──────────
r.get('/session', requireAuth, (c) =>
  c.json({ ok: true, data: { valid: true, expiresAt: c.get('session').expiresAt } })
);

// ── خروج ───────────────────────────────────────────────────────────
r.post('/logout', requireAuth, async (c) => {
  await deleteSession(c.env, c.get('token'));
  return c.json({ ok: true, data: { loggedOut: true } });
});

// ── تغییر رمز عبور از داخل پنل ─────────────────────────────────────
r.post('/change-password', requireAuth, async (c) => {
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');

  // رمز جدید باید حداقل ۶ کاراکتر باشد
  if (newPassword.length < 6) {
    return c.json({ ok: false, error: 'invalid_password' }, 400);
  }

  // رمز فعلی باید درست باشد
  const ok = await verifyAdminPassword(env, currentPassword);
  if (!ok) {
    return c.json({ ok: false, error: 'wrong_password' }, 401);
  }

  // ذخیره هش رمز جدید + ابطال همه نشست‌های دیگر (جز همین دستگاه)
  await setAdminPassword(env, newPassword);
  await deleteAllSessions(env, c.get('token'));

  return c.json({ ok: true, data: { changed: true } });
});

export default r;
