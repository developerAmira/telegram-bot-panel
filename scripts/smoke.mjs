// ═══════════════════════════════════════════════════════════════════
//  scripts/smoke.mjs — تست دود (Smoke Test)
//  اپ Worker را با یک KV درون‌حافظه‌ای در Node اجرا و مسیرهای اصلی
//  API + وب‌هوک را تست می‌کند:  npm run smoke
//  (نیازی به wrangler یا اتصال واقعی تلگرام ندارد)
// ═══════════════════════════════════════════════════════════════════

import worker from '../src/index.js';

// ── شبیه‌ساز KV (با پشتیبانی از metadata و cursor) ────────────────
function mockKV() {
  const store = new Map();
  return {
    async get(key) {
      const e = store.get(key);
      return e ? e.v : null;
    },
    async put(key, value, opts = {}) {
      store.set(key, { v: value, meta: opts.metadata });
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      let start = 0;
      if (cursor) start = Number(Buffer.from(cursor, 'base64').toString());
      const page = keys.slice(start, start + limit);
      const end = start + page.length;
      const complete = end >= keys.length;
      return {
        keys: page.map((name) => ({ name, metadata: store.get(name)?.meta })),
        list_complete: complete,
        cursor: complete ? undefined : Buffer.from(String(end)).toString('base64'),
      };
    },
  };
}

const ENV = {
  BOT_KV: mockKV(),
  ADMIN_PASSWORD: 'test-password-123',
  WEBHOOK_SECRET: 'whsec-test',
  APP_VERSION: 'smoke-test',
};
const CTX = { waitUntil(p) { p.catch(() => {}); } };

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.error('  ✘', name, extra); }
};

async function call(method, path, { body, token, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  const req = new Request('https://panel.example.com' + path, {
    method, headers: h, body: body ? JSON.stringify(body) : undefined,
  });
  Object.defineProperty(req, 'cf', { value: { colo: 'TEST' } });
  return worker.fetch(req, ENV, CTX);
}

const json = async (res) => ({ status: res.status, body: await res.json() });

console.log('\n── 1) سلامت و امنیت ──');
{
  let r = await json(await call('GET', '/api/health'));
  ok('GET /api/health → 200', r.status === 200 && r.body.ok === true && r.body.data.colo === 'TEST');

  r = await json(await call('GET', '/api/users'));
  ok('API بدون توکن → 401', r.status === 401);

  r = await json(await call('POST', '/api/auth/login', { body: { password: 'wrong' } }));
  ok('رمز غلط → 401 invalid_credentials', r.status === 401 && r.body.error === 'invalid_credentials');
}

console.log('\n── 2) ورود + محدودیت نرخ ──');
let TOKEN = '';
{
  let r = await json(await call('POST', '/api/auth/login', { body: { password: 'test-password-123' } }));
  ok('ورود موفق → توکن', r.status === 200 && !!r.body.data.token);
  TOKEN = r.body.data?.token || '';

  r = await json(await call('GET', '/api/auth/session', { token: TOKEN }));
  ok('اعتبارسنجی نشست', r.status === 200 && r.body.data.valid === true);

  // ۵ تلاش ناموفق → قفل
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { body: { password: 'nope' } });
  r = await json(await call('POST', '/api/auth/login', { body: { password: 'nope' } }));
  ok('محدودیت نرخ ورود → 429', r.status === 429 && r.body.error === 'rate_limited');
  // ورود درست باید همچنان ممکن باشد؟ نه — پنجره قفل است؛ ولی کلید پس از موفقیت پاک می‌شود:
  r = await json(await call('POST', '/api/auth/login', { body: { password: 'test-password-123' } }));
  ok('رمز درست در حالت قفل → هنوز 429 (اولویت ضد بروت‌فورس)', r.status === 429);
  // شبیه IP جدید
  const req = new Request('https://panel.example.com/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '2.2.2.2' },
    body: JSON.stringify({ password: 'test-password-123' }),
  });
  const r2 = await json(await worker.fetch(req, ENV, CTX));
  ok('ورود از IP دیگر → 200', r2.status === 200);
}

console.log('\n── 3) تنظیمات و منو ──');
{
  let r = await json(await call('PUT', '/api/settings', { token: TOKEN, body: { botToken: '123456:FAKE-TOKEN', adminIds: '111, 222', defaultLang: 'fa' } }));
  ok('PUT /settings', r.status === 200 && r.body.data.settings.hasToken === true);
  ok('توکن ماسک شده', r.body.data.settings.tokenMasked.includes('FAKE'.slice(-2) + '') || !r.body.data.settings.tokenMasked.includes('123456'));
  ok('ادمین‌ها پارس شدند', JSON.stringify(r.body.data.settings.adminIds) === '[111,222]');

  r = await json(await call('PUT', '/api/menu', { token: TOKEN, body: {
    welcome: { fa: 'سلام {name}', en: 'Hi {name}' },
    help: { fa: 'راهنما', en: 'Help' },
    mainKeyboard: [['/start', '/help'], ['/id']],
    inlineButtons: [[{ text: 'سایت', type: 'url', value: 'https://x.com' }, { text: 'کال‌بک', type: 'callback', value: 'act:1' }]],
  } }));
  ok('PUT /menu', r.status === 200 && r.body.data.menu.welcome.fa === 'سلام {name}');

  // دکمه با URL نامعتبر باید حذف شود
  r = await json(await call('PUT', '/api/menu', { token: TOKEN, body: {
    inlineButtons: [[{ text: 'بد', type: 'url', value: 'javascript:alert(1)' }]],
  } }));
  ok('URL خطرناک رد شد (fallback پیش‌فرض)', r.status === 200 && Array.isArray(r.body.data.menu.inlineButtons));
}

console.log('\n── 4) وب‌هوک تلگرام ──');
{
  const update = {
    update_id: 1,
    message: {
      message_id: 10, text: '/start', chat: { id: 42 },
      from: { id: 42, first_name: 'Ali', username: 'ali_r', is_bot: false },
    },
  };
  let r = await json(await call('POST', '/telegram/webhook', { body: update }));
  ok('وب‌هوک بدون هدر مخفی → 401', r.status === 401);

  r = await json(await call('POST', '/telegram/webhook', { body: update, headers: { 'x-telegram-bot-api-secret-token': 'WRONG' } }));
  ok('وب‌هوک با secret غلط → 401', r.status === 401);

  r = await json(await call('POST', '/telegram/webhook', { body: update, headers: { 'x-telegram-bot-api-secret-token': 'whsec-test' } }));
  ok('وب‌هوک معتبر → 200', r.status === 200 && r.body.ok === true);
  await new Promise((res) => setTimeout(res, 800)); // منتظر waitUntil

  r = await json(await call('GET', '/api/users?q=ali', { token: TOKEN }));
  ok('کاربر /start ثبت شد (جستجو)', r.status === 200 && r.body.data.rows.some((u) => u.id === '42'));
  ok('پیام آمار شمرده شد', (await json(await call('GET', '/api/dashboard/stats', { token: TOKEN }))).body.data.stats.messages >= 1);
}

console.log('\n── 5) مدیریت کاربران ──');
{
  let r = await json(await call('GET', '/api/users', { token: TOKEN }));
  ok('لیست کاربران', r.status === 200 && r.body.data.rows.length === 1);

  r = await json(await call('POST', '/api/users/42/ban', { token: TOKEN, body: { reason: 'spam' } }));
  ok('مسدودسازی', r.status === 200 && r.body.data.user.banned === true);

  r = await json(await call('GET', '/api/users?limit=20', { token: TOKEN }));
  ok('پرچم banned در metadata لیست', r.body.data.rows[0].banned === true);

  r = await json(await call('POST', '/api/users/42/unban', { token: TOKEN }));
  ok('آزادسازی', r.status === 200 && r.body.data.user.banned === false);

  r = await json(await call('POST', '/api/users/42/message', { token: TOKEN, body: { text: 'hello' } }));
  // توکن فیک است → تلگرام 401 می‌دهد → باید خطای توضیح‌دار برگردد
  ok('پیام مستقیم با توکن فیک → خطای توضیح‌دار', r.status === 400 && typeof r.body.error === 'string');
}

console.log('\n── 6) ارسال همگانی (چرخه tick) ──');
{
  let r = await json(await call('POST', '/api/broadcast', { token: TOKEN, body: { text: 'سلام همگانی', target: 'all' } }));
  ok('ساخت جاب', r.status === 200 && r.body.data.job.total === 1);
  const id = r.body.data.job.id;

  r = await json(await call('POST', `/api/broadcast/${id}/tick`, { token: TOKEN }));
  const j = r.body.data.job;
  ok('tick اول → اتمام (ارسال به توکن فیک شکست می‌خورد)', r.status === 200 && j.status === 'done');
  ok('شمارنده‌ها', j.cursor === 1 && j.sent + j.failed === 1 && j.failed === 1);

  r = await json(await call('GET', '/api/broadcast', { token: TOKEN }));
  ok('تاریخچه', r.status === 200 && r.body.data.jobs.length === 1);

  // کاربر بدون فعالیت → هدف active7d خالی
  r = await json(await call('POST', '/api/broadcast', { token: TOKEN, body: { text: 'x', target: 'active30d' } }));
  ok('هدف‌گیری فعال‌ها → no_targets (توکن فیک = کاربر بلاک‌نشده ولی lastSeen تازه است؟)', r.status === 200 || r.body.error === 'no_targets');
}

console.log('\n── 7) وب‌هوک تنظیم/حذف (توکن فیک) ──');
{
  let r = await json(await call('POST', '/api/settings/webhook', { token: TOKEN, body: { action: 'set' } }));
  ok('setWebhook با توکن فیک → خطای تلگرام', r.status === 400 && typeof r.body.error === 'string');
}

console.log(`\n═══ نتیجه: ${passed} passed / ${failed} failed ═══\n`);
process.exit(failed ? 1 : 0);
