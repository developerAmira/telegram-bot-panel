// ═══════════════════════════════════════════════════════════════════
//  routes/broadcast.routes.js — موتور ارسال پیام / نظرسنجی / عکس
//
//  انواع پیام (kind):
//   text → متن (+ دکمه‌های URL)
//   poll → نظرسنجی تعاملی با شمارش زنده آرا
//   photo→ عکس با کپشن + دکمه‌های 👍/👎
//
//  مخاطبان (target):
//   all / active7d / active30d → جاب دسته‌ای (tick) برای همه کاربران
//   users  → ارسال فوری به حداکثر ۵۰ آیدی خاص
//   chat   → ارسال فوری به یک چت (کانال/گروه/کاربر) — مثلاً -100123…
//
//  POST /            → ساخت ارسال        POST /:id/tick   → دسته بعدی
//  POST /:id/pause|resume|stop            GET  /           → تاریخچه
// ═══════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import {
  K, getJson, putJson, bumpStats, collectTargetIds, getUser, putUser,
  pushBroadcastId, getRecentBroadcasts, getSettings, pushEngIndex,
} from '../kv.js';
import { resolveToken, sendToUser, sendPollToChat, sendPostToChat, sleep } from '../telegram.js';

const r = new Hono();
r.use('*', requireAuth);

const fail = (c, error, status = 400) => c.json({ ok: false, error }, status);

// ── اعتبارسنجی دکمه‌های URL ────────────────────────────────────────
function sanitizeUrlButtons(input) {
  if (!Array.isArray(input)) return [];
  const rows = [];
  for (const row of input.slice(0, 8)) {
    if (!Array.isArray(row)) continue;
    const btns = [];
    for (const b of row.slice(0, 8)) {
      const text = String((b && b.text) || '').trim();
      const url = String((b && b.url) || '').trim();
      if (text.length >= 1 && text.length <= 64 && /^https?:\/\//i.test(url)) {
        btns.push({ text, url });
      }
    }
    if (btns.length) rows.push(btns);
  }
  return rows;
}

// ارسال یک پیام از هر نوع به یک چت — قلب مشترک ارسال فوری و دسته‌ای
async function deliverOne(token, kind, payload, chatId) {
  if (kind === 'poll') return sendPollToChat(token, chatId, payload.poll);
  if (kind === 'photo') return sendPostToChat(token, chatId, payload.post, payload.parseMode || undefined);
  return sendToUser(token, chatId, payload.text, {
    parse_mode: payload.parseMode || undefined,
    disable_web_page_preview: true,
    reply_markup: payload.buttons && payload.buttons.length
      ? { inline_keyboard: payload.buttons.map((row) => row.map((b) => ({ text: b.text, url: b.url }))) }
      : undefined,
  });
}

// ── ساخت ارسال (فوری یا جاب همگانی) ────────────────────────────────
r.post('/', async (c) => {
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));

  const kind = ['text', 'poll', 'photo'].includes(body.kind) ? body.kind : 'text';
  const target = ['all', 'active7d', 'active30d', 'users', 'chat'].includes(body.target) ? body.target : 'all';
  const parseMode = ['HTML', 'MarkdownV2'].includes(body.parseMode) ? body.parseMode : null;

  const token = await resolveToken(env);
  if (!token) return fail(c, 'token_missing');

  // ── اعتبارسنجی و ساخت payload بر اساس نوع ──
  const payload = { kind, parseMode };
  if (kind === 'text') {
    const text = String(body.text || '').trim();
    if (!text || text.length > 4096) return fail(c, 'invalid_text');
    payload.text = text;
    payload.buttons = sanitizeUrlButtons(body.buttons);
  } else if (kind === 'poll') {
    const q = String(body.poll?.question || '').trim();
    const opts = Array.isArray(body.poll?.options)
      ? body.poll.options.map((o) => String(o || '').trim().slice(0, 100)).filter(Boolean)
      : [];
    if (!q || q.length > 300) return fail(c, 'invalid_question');
    if (opts.length < 2 || opts.length > 10) return fail(c, 'invalid_options');
    const id = crypto.randomUUID().slice(0, 8);
    payload.poll = { id, q, opts: opts.map((label) => ({ label, n: 0 })), voters: {}, createdAt: Date.now() };
  } else {
    const photo = String(body.photo?.url || '').trim();
    const caption = String(body.photo?.caption || '').trim();
    if (!/^https?:\/\//i.test(photo) || photo.length > 512) return fail(c, 'invalid_photo_url');
    if (caption.length > 1024) return fail(c, 'invalid_caption');
    const id = crypto.randomUUID().slice(0, 8);
    payload.post = { id, photo, caption, likes: 0, dislikes: 0, voters: {}, createdAt: Date.now() };
  }

  // ── ثبت رکورد نظرسنجی/پست (برای شمارش زنده) ──
  if (kind === 'poll') { await putJson(env, K.POLL(payload.poll.id), payload.poll); await pushEngIndex(env, 'poll', payload.poll.id); }
  if (kind === 'photo') { await putJson(env, K.POST(payload.post.id), payload.post); await pushEngIndex(env, 'post', payload.post.id); }

  // ── هدف: کاربران خاص (فوری، حداکثر ۵۰) ──
  if (target === 'users') {
    const ids = (Array.isArray(body.userIds) ? body.userIds : String(body.userIds || '').split(/[,،\s]+/))
      .map((x) => Number(String(x).trim())).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
    if (!ids.length) return fail(c, 'invalid_user_ids');
    const results = [];
    for (const uid of ids) {
      const res = await deliverOne(token, kind, payload, uid);
      results.push({ id: uid, ok: !!res.ok, error: res.ok ? undefined : res.description });
      if (res.error_code === 403) await markBlockedBot(env, uid);
      await sleep(40);
    }
    await bumpStats(env, { broadcasts: 1 });
    const sent = results.filter((x) => x.ok).length;
    if (sent) await bumpStats(env, { sent });
    return c.json({ ok: true, data: { mode: 'direct', results, sent, failed: results.length - sent } });
  }

  // ── هدف: کانال/گروه/چت خاص (فوری) ──
  if (target === 'chat') {
    const chatId = Number(body.chatId);
    if (!Number.isInteger(chatId) || chatId === 0) return fail(c, 'invalid_chat_id');
    const res = await deliverOne(token, kind, payload, chatId);
    await bumpStats(env, { broadcasts: 1 });
    if (res.ok) await bumpStats(env, { sent: 1 });
    return c.json({
      ok: true,
      data: { mode: 'direct', results: [{ id: chatId, ok: !!res.ok, error: res.ok ? undefined : res.description }], sent: res.ok ? 1 : 0, failed: res.ok ? 0 : 1 },
    });
  }

  // ── هدف همگانی → جاب دسته‌ای (tick از پنل) ──
  const withinDays = target === 'all' ? 0 : Number(target.replace('active', '').replace('d', ''));
  const ids = await collectTargetIds(env, withinDays);
  if (!ids.length) return fail(c, 'no_targets');

  const id = crypto.randomUUID().slice(0, 8);
  const job = {
    id, kind, target,
    text: payload.text || null,
    parseMode: payload.parseMode || null,
    buttons: payload.buttons || null,
    pollId: payload.poll ? payload.poll.id : null,
    postId: payload.post ? payload.post.id : null,
    photoUrl: payload.post ? payload.post.photo : null,
    caption: payload.post ? payload.post.caption : null,
    targets: ids,
    total: ids.length,
    cursor: 0, sent: 0, failed: 0,
    status: 'running',
    createdAt: Date.now(),
    finishedAt: null,
    errors: [],
  };
  await putJson(env, K.BROADCAST(id), job);
  await pushBroadcastId(env, id);
  await bumpStats(env, { broadcasts: 1 });

  return c.json({ ok: true, data: { job: { ...job, targets: undefined } } });
});

// ── ارسال دسته بعدی (قلب موتور همگانی) ────────────────────────────
r.post('/:id/tick', async (c) => {
  const env = c.env;
  const id = c.req.param('id');

  const job = await getJson(env, K.BROADCAST(id));
  if (!job) return fail(c, 'not_found', 404);

  if (job.status === 'ticking') {
    return c.json({ ok: true, data: { job: { ...job, status: 'running' } } });
  }
  if (job.status !== 'running') return c.json({ ok: true, data: { job } });

  const token = await resolveToken(env);
  if (!token) {
    job.status = 'failed';
    job.errors.push({ code: 0, d: 'token_missing' });
    await putJson(env, K.BROADCAST(id), job);
    return fail(c, 'token_missing');
  }

  const settings = await getSettings(env);
  const batch = Math.min(Math.max(Number(settings.broadcast.batchSize) || 25, 1), 50);
  const delay = Math.min(Math.max(Number(settings.broadcast.delayMs) || 40, 20), 500);

  job.status = 'ticking';
  await putJson(env, K.BROADCAST(id), job);

  // برای نظرسنجی/عکس، آخرین وضعیت رکورد را بگیر (شمارنده‌ها زنده‌اند)
  let payload = { kind: job.kind, parseMode: job.parseMode, text: job.text, buttons: job.buttons };
  if (job.kind === 'poll' && job.pollId) payload.poll = await getJson(env, K.POLL(job.pollId));
  if (job.kind === 'photo' && job.photoUrl) payload.post = await getJson(env, K.POST(job.postId));

  const slice = job.targets.slice(job.cursor, job.cursor + batch);
  let sent = 0, failed = 0;
  for (const uid of slice) {
    const res = await deliverOne(token, job.kind, payload, Number(uid));
    if (res.ok) sent++;
    else {
      failed++;
      if (res.error_code === 403) await markBlockedBot(env, uid);
      if (job.errors.length < 50) {
        job.errors.push({ id: uid, code: res.error_code || 0, d: String(res.description || '').slice(0, 120) });
      }
    }
    if (delay) await sleep(delay);
  }

  job.sent += sent;
  job.failed += failed;
  job.cursor += slice.length;
  const done = job.cursor >= job.targets.length;
  job.status = done ? 'done' : 'running';
  if (done) job.finishedAt = Date.now();

  await putJson(env, K.BROADCAST(id), job);
  if (sent) await bumpStats(env, { sent });

  return c.json({ ok: true, data: { job: { ...job, targets: undefined } } });
});

// علامت‌گذاری کاربری که ربات را بلاک کرده (خطای 403 تلگرام)
async function markBlockedBot(env, uid) {
  const user = await getUser(env, uid);
  if (user && !user.blockedBot) {
    user.blockedBot = true;
    await putUser(env, user);
  }
}

// ── کنترل جاب ──────────────────────────────────────────────────────
const TRANSITIONS = {
  pause: { from: ['running', 'ticking'], to: 'paused' },
  resume: { from: ['paused'], to: 'running' },
  stop: { from: ['running', 'ticking', 'paused'], to: 'stopped' },
};

for (const [action, tr] of Object.entries(TRANSITIONS)) {
  r.post(`/:id/${action}`, async (c) => {
    const id = c.req.param('id');
    const job = await getJson(c.env, K.BROADCAST(id));
    if (!job) return fail(c, 'not_found', 404);
    if (tr.from.includes(job.status)) {
      job.status = tr.to;
      if (tr.to === 'stopped') job.finishedAt = Date.now();
      await putJson(c.env, K.BROADCAST(id), job);
    }
    return c.json({ ok: true, data: { job: { ...job, targets: undefined } } });
  });
}

// ── وضعیت و تاریخچه ────────────────────────────────────────────────
r.get('/', async (c) =>
  c.json({ ok: true, data: { jobs: await getRecentBroadcasts(c.env) } })
);

r.get('/:id', async (c) => {
  const job = await getJson(c.env, K.BROADCAST(c.req.param('id')));
  if (!job) return fail(c, 'not_found', 404);
  return c.json({ ok: true, data: { job: { ...job, targets: undefined } } });
});

export default r;
