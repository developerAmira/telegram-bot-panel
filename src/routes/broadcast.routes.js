// ═══════════════════════════════════════════════════════════════════
//  routes/broadcast.routes.js — موتور ارسال پیام همگانی
//
//  ⚙️ معماری: چون هر درخواست Worker محدود به ~50 subrequest (پلن رایگان)
//  است، ارسال انبوه به‌صورت «دسته‌ای از سمت کلاینت» انجام می‌شود:
//   1) POST /           → ساخت جاب با لیست کامل هدف‌ها در KV
//   2) POST /:id/tick   → ارسال دسته بعدی (batchSize پیام با تاخیر delayMs)
//   3) کلاینت (پنل) تا تکمیل، tick می‌زند → نوار پیشرفت زنده + قابلیت توقف
//  مزیت: بدون محدودیت تعداد، قابل ازسرگیری (resume) و شفاف برای ادمین.
//  ⚠️ محدودیت تلگرام رعایت می‌شود: ~۲۰ پیام/ثانیه و فاصله بین هر پیام.
// ═══════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import {
  K, getJson, putJson, bumpStats, collectTargetIds, getUser, putUser,
  pushBroadcastId, getRecentBroadcasts, getSettings,
} from '../kv.js';
import { resolveToken, sendToUser, sleep } from '../telegram.js';

const r = new Hono();
r.use('*', requireAuth);

const fail = (c, error, status = 400) => c.json({ ok: false, error }, status);

// اعتبارسنجی دکمه‌های URL ارسال همگانی (rows × buttons)
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

// ── ساخت جاب ارسال همگانی ──────────────────────────────────────────
r.post('/', async (c) => {
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));

  const text = String(body.text || '').trim();
  if (!text || text.length > 4096) return fail(c, 'invalid_text');

  const parseMode = ['HTML', 'MarkdownV2'].includes(body.parseMode) ? body.parseMode : null;
  const buttons = sanitizeUrlButtons(body.buttons);
  const target = ['all', 'active7d', 'active30d'].includes(body.target) ? body.target : 'all';

  const token = await resolveToken(env);
  if (!token) return fail(c, 'token_missing');

  // ضمنDays: 0 برای all، 7/30 برای دسته‌های فعال
  const withinDays = target === 'all' ? 0 : Number(target.replace('active', '').replace('d', ''));
  const ids = await collectTargetIds(env, withinDays);
  if (!ids.length) return fail(c, 'no_targets');

  const id = crypto.randomUUID().slice(0, 8);
  const job = {
    id, text, parseMode, buttons, target,
    targets: ids,
    total: ids.length,
    cursor: 0, sent: 0, failed: 0,
    status: 'running', // running | paused | stopped | done | failed
    createdAt: Date.now(),
    finishedAt: null,
    errors: [], // {id, code, d} — حداکثر ۵۰ خطای اخیر
  };
  await putJson(env, K.BROADCAST(id), job);
  await pushBroadcastId(env, id);
  await bumpStats(env, { broadcasts: 1 });

  // در پاسخ، آرایه سنگین targets را نمی‌فرستیم
  return c.json({ ok: true, data: { job: { ...job, targets: undefined } } });
});

// ── ارسال دسته بعدی (قلب موتور) ────────────────────────────────────
r.post('/:id/tick', async (c) => {
  const env = c.env;
  const id = c.req.param('id');

  const job = await getJson(env, K.BROADCAST(id));
  if (!job) return fail(c, 'not_found', 404);

  // قفل ساده ضد هم‌زمانی: اگر tick دیگری در جریان است، وضعیت فعلی را برگردان
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

  // تنظیمات Rate-Limit از پنل
  const settings = await getSettings(env);
  const batch = Math.min(Math.max(Number(settings.broadcast.batchSize) || 25, 1), 50);
  const delay = Math.min(Math.max(Number(settings.broadcast.delayMs) || 40, 20), 500);

  // فعال‌سازی قفل
  job.status = 'ticking';
  await putJson(env, K.BROADCAST(id), job);

  const slice = job.targets.slice(job.cursor, job.cursor + batch);
  const markup = job.buttons && job.buttons.length
    ? { inline_keyboard: job.buttons.map((row) => row.map((b) => ({ text: b.text, url: b.url }))) }
    : undefined;

  let sent = 0;
  let failed = 0;
  for (const uid of slice) {
    const res = await sendToUser(token, Number(uid), job.text, {
      parse_mode: job.parseMode || undefined,
      disable_web_page_preview: true,
      reply_markup: markup,
    });
    if (res.ok) {
      sent++;
    } else {
      failed++;
      // 403 = کاربر ربات را بلاک کرده → به‌صورت خودکار علامت بزن
      if (res.error_code === 403) await markBlockedBot(env, uid);
      if (job.errors.length < 50) {
        job.errors.push({ id: uid, code: res.error_code || 0, d: String(res.description || '').slice(0, 120) });
      }
    }
    if (delay) await sleep(delay); // احترام به محدودیت نرخ تلگرام
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
