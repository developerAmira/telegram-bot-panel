// ═══════════════════════════════════════════════════════════════════
//  routes/support.routes.js — صندوق پشتیبانی دوطرفه
//
//  کاربر در ربات /support می‌فرستد → پیام‌هایش به تیکت می‌روند؛
//  ادمین از پنل پاسخ می‌دهد → پاسخ برای کاربر در تلگرام ارسال می‌شود.
//
//  GET  /api/support/tickets            → لیست تیکت‌ها (با unread)
//  GET  /api/support/tickets/unread     → تعداد خوانده‌نشده (badge)
//  GET  /api/support/tickets/:id        → متن کامل تیکت (+ خوانده‌شدن)
//  POST /api/support/tickets/:id/reply  → پاسخ ادمین {text}
//  POST /api/support/tickets/:id/close  → بستن تیکت
// ═══════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import {
  getTicket, getTicketsList, markTicketRead, ticketAppendAdmin, closeTicket, getUser,
} from '../kv.js';
import { resolveToken, sendToUser } from '../telegram.js';

const r = new Hono();
r.use('*', requireAuth);

const fail = (c, error, status = 400) => c.json({ ok: false, error }, status);

// ── لیست تیکت‌ها ───────────────────────────────────────────────────
r.get('/tickets', async (c) =>
  c.json({ ok: true, data: { tickets: await getTicketsList(c.env) } })
);

// ── شمارنده خوانده‌نشده (برای badge ناوبری) ────────────────────────
r.get('/tickets/unread', async (c) => {
  const list = await getTicketsList(c.env);
  const count = list.reduce((a, x) => a + (x.unread || 0), 0);
  return c.json({ ok: true, data: { count } });
});

// ── محتوای تیکت + علامت خوانده‌شدن ─────────────────────────────────
r.get('/tickets/:id', async (c) => {
  const id = c.req.param('id');
  const t = await getTicket(c.env, id);
  if (!t) return fail(c, 'not_found', 404);
  await markTicketRead(c.env, id);
  const tickets = await getTicketsList(c.env); // لیست تازه‌شده (unread=0)
  return c.json({ ok: true, data: { ticket: t, tickets } });
});

// ── پاسخ ادمین ─────────────────────────────────────────────────────
r.post('/tickets/:id/reply', async (c) => {
  const env = c.env;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const text = String(body.text || '').trim();
  if (!text || text.length > 3000) return fail(c, 'invalid_text');

  const t = await getTicket(env, id);
  if (!t) return fail(c, 'not_found', 404);

  // ثبت پاسخ در تیکت
  const updated = await ticketAppendAdmin(env, id, text);

  // ارسال به کاربر در تلگرام (بهترین تلاش — خطا مانع ثبت نمی‌شود)
  let delivered = false;
  const token = await resolveToken(env);
  if (token) {
    const u = await getUser(env, id);
    const header = (u && u.lang) === 'en' ? '💬 Support reply:' : '💬 پاسخ پشتیبانی:';
    const res = await sendToUser(token, Number(id), `${header}\n\n${text}`);
    delivered = !!res.ok;
  }

  const tickets = await getTicketsList(env);
  return c.json({ ok: true, data: { ticket: updated, delivered, tickets } });
});

// ── بستن تیکت ──────────────────────────────────────────────────────
r.post('/tickets/:id/close', async (c) => {
  const env = c.env;
  const id = c.req.param('id');
  const t = await closeTicket(env, id);
  if (!t) return fail(c, 'not_found', 404);

  const token = await resolveToken(env);
  if (token) {
    const u = await getUser(env, id);
    const msg = (u && u.lang) === 'en'
      ? '✅ Support chat closed. Send /support whenever you need us again.'
      : '✅ گفتگوی پشتیبانی بسته شد. نیاز بود /support را بفرستید.';
    await sendToUser(token, Number(id), msg);
  }
  const tickets = await getTicketsList(env);
  return c.json({ ok: true, data: { ticket: t, tickets } });
});

export default r;
