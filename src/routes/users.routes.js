// ═══════════════════════════════════════════════════════════════════
//  routes/users.routes.js — مدیریت کاربران ربات
//  GET   /api/users?cursor&limit&q → لیست صفحه‌بندی‌شده / جستجو
//  GET   /api/users/:id            → رکورد کامل کاربر
//  POST  /api/users/:id/ban        → مسدودسازی {reason?}
//  POST  /api/users/:id/unban      → آزادسازی
//  POST  /api/users/:id/message    → پیام مستقیم {text, parseMode?}
// ═══════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { getUser, putUser, listUsersPage, searchUsers, bumpStats } from '../kv.js';
import { resolveToken, sendToUser } from '../telegram.js';

const r = new Hono();
r.use('*', requireAuth);

const fail = (c, error, status = 400) => c.json({ ok: false, error }, status);

// ── لیست کاربران (صفحه‌بندی با cursor بومی KV) ──────────────────────
r.get('/', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 20, 5), 100);
  const q = (c.req.query('q') || '').trim();

  if (q) {
    const rows = await searchUsers(c.env, q);
    return c.json({ ok: true, data: { rows, nextCursor: null, search: true } });
  }

  const page = await listUsersPage(c.env, { cursor: c.req.query('cursor') || undefined, limit });
  return c.json({ ok: true, data: { ...page, search: false } });
});

// ── رکورد کامل یک کاربر ────────────────────────────────────────────
r.get('/:id', async (c) => {
  const user = await getUser(c.env, c.req.param('id'));
  if (!user) return fail(c, 'user_not_found', 404);
  return c.json({ ok: true, data: { user } });
});

// ── مسدودسازی ──────────────────────────────────────────────────────
r.post('/:id/ban', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const user = await getUser(c.env, c.req.param('id'));
  if (!user) return fail(c, 'user_not_found', 404);

  const wasBanned = !!user.banned;
  user.banned = true;
  user.bannedAt = Date.now();
  user.banReason = String(body.reason || '').slice(0, 200);
  await putUser(c.env, user);
  if (!wasBanned) await bumpStats(c.env, { banned: 1 });

  return c.json({ ok: true, data: { user } });
});

// ── آزادسازی ───────────────────────────────────────────────────────
r.post('/:id/unban', async (c) => {
  const user = await getUser(c.env, c.req.param('id'));
  if (!user) return fail(c, 'user_not_found', 404);

  const wasBanned = !!user.banned;
  user.banned = false;
  user.bannedAt = 0;
  user.banReason = '';
  await putUser(c.env, user);
  if (wasBanned) await bumpStats(c.env, { banned: -1 });

  return c.json({ ok: true, data: { user } });
});

// ── ارسال پیام مستقیم به یک کاربر ──────────────────────────────────
r.post('/:id/message', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const text = String(body.text || '').trim();
  if (!text || text.length > 4096) return fail(c, 'invalid_text');

  const token = await resolveToken(c.env);
  if (!token) return fail(c, 'token_missing');

  const user = await getUser(c.env, c.req.param('id'));
  if (!user) return fail(c, 'user_not_found', 404);
  if (user.banned) return fail(c, 'user_banned');

  const extra = {
    disable_web_page_preview: true,
    parse_mode: ['HTML', 'MarkdownV2'].includes(body.parseMode) ? body.parseMode : undefined,
  };
  const res = await sendToUser(token, user.id, text, extra);
  if (!res.ok) return fail(c, res.description || 'telegram_error');

  return c.json({ ok: true, data: { sent: true } });
});

export default r;
