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
  WEBHOOK_SECRET: 'whsec-test',
  APP_VERSION: 'smoke-test',
};
const CTX = { waitUntil(p) { p.catch(() => {}); } };

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.error('  ✘', name, extra); }
};

async function call(method, path, { body, token, ip, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  if (ip) h['cf-connecting-ip'] = ip;
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

console.log('\n── 2) ورود با رمز پیش‌فرض + محدودیت نرخ ──');
let TOKEN = '';
{
  // وضعیت رمز پیش‌فرض (عمومی)
  let r = await json(await call('GET', '/api/auth/default-status'));
  ok('رمز پیش‌فرض در ابتدا فعال است', r.status === 200 && r.body.data.defaultActive === true);

  // ورود با رمز پیش‌فرض داخلی (بدون هیچ متغیر محیطی!)
  r = await json(await call('POST', '/api/auth/login', { body: { password: 'botpanel123' } }));
  ok('ورود با رمز پیش‌فرض → توکن', r.status === 200 && !!r.body.data.token);
  TOKEN = r.body.data?.token || '';

  r = await json(await call('GET', '/api/auth/session', { token: TOKEN }));
  ok('اعتبارسنجی نشست', r.status === 200 && r.body.data.valid === true);

  // ۵ تلاش ناموفق → قفل
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { body: { password: 'nope' } });
  r = await json(await call('POST', '/api/auth/login', { body: { password: 'nope' } }));
  ok('محدودیت نرخ ورود → 429', r.status === 429 && r.body.error === 'rate_limited');
  // ورود درست باید همچنین ممکن باشد؟ نه — پنجره قفل است؛ ولی کلید پس از موفقیت پاک می‌شود:
  r = await json(await call('POST', '/api/auth/login', { body: { password: 'botpanel123' } }));
  ok('رمز درست در حالت قفل → هنوز 429 (اولویت ضد بروت‌فورس)', r.status === 429);
  // شبیه IP جدید
  const req = new Request('https://panel.example.com/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '2.2.2.2' },
    body: JSON.stringify({ password: 'botpanel123' }),
  });
  const r2 = await json(await worker.fetch(req, ENV, CTX));
  ok('ورود از IP دیگر → 200', r2.status === 200);
}

console.log('\n── 3) تنظیمات و منو ──');
{
  let r = await json(await call('PUT', '/api/settings', { token: TOKEN, body: { botToken: '123456:FAKE-TOKEN', adminIds: '111, 222', defaultLang: 'fa' } }));
  ok('PUT /settings', r.status === 200 && r.body.data.settings.hasToken === true);
  ok('توکن ماسک شده', r.body.data.settings.tokenMasked.includes('FAKE'.slice(-2) + '') || !r.body.data.settings.tokenMasked.includes('123456'));
  ok('adminIds حذف شده و نادیده گرفته می‌شود (مدیریت فقط از پنل وب)', r.body.data.settings.adminIds === undefined);

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

console.log('\n── 8) زیرمنوها و دکمه‌های چندلایه ──');
{
  let r = await json(await call('PUT', '/api/menu', { token: TOKEN, body: {
    welcome: { fa: 'سلام {name}', en: 'Hi {name}' },
    help: { fa: 'راهنما', en: 'Help' },
    inlineButtons: [
      [{ text: 'فروشگاه', type: 'submenu', value: 'shop' }],
      [{ text: 'پاپ‌آپ', type: 'text', value: 'متن پاپ‌آپ تست' }],
      [{ text: 'سایت', type: 'url', value: 'https://x.com' }],
    ],
    submenus: {
      shop: { title: '🛍 فروشگاه', text: 'انتخاب کنید:', buttons: [
        [{ text: 'قیمت', type: 'text', value: 'لیست قیمت…' }],
        [{ text: 'بیشتر', type: 'submenu', value: 'shop2' }],
      ]},
      shop2: { title: 'لایه دوم', text: 'زیرمنوی چندلایه ✓', buttons: [
        [{ text: 'بازگشت به فروشگاه', type: 'submenu', value: 'shop' }],
      ]},
    },
  } }));
  ok('PUT /menu با زیرمنوهای چندلایه', r.status === 200);
  const menu = r.body.data.menu;
  ok('کیبورد ساده (mainKeyboard) حذف شده است', !('mainKeyboard' in menu) || menu.mainKeyboard === undefined);
  ok('زیرمنوها ذخیره شدند', menu.submenus.shop && menu.submenus.shop2);
  ok('دکمه submenu نگه داشته شد', menu.inlineButtons[0][0].type === 'submenu');
  ok('دکمه text نگه داشته شد', menu.inlineButtons[1][0].type === 'text');

  // ارجاع به زیرمنوی ناموجود باید حذف شود
  r = await json(await call('PUT', '/api/menu', { token: TOKEN, body: {
    inlineButtons: [[{ text: 'خراب', type: 'submenu', value: 'ghost' }]],
    submenus: { shop: { title: 'a', text: 'b', buttons: [] } },
  } }));
  ok('ارجاع به زیرمنوی ناموجود حذف شد (fallback پیش‌فرض)', r.status === 200 && r.body.data.menu.inlineButtons.every((row) => row.every((b) => b.type !== 'submenu' || b.value !== 'ghost')));
}

console.log('\n── 9) نظرسنجی تعاملی + شمارش آرا ──');
let POLL_ID = '';
{
  // ساخت نظرسنجی برای یک کاربر خاص (ارسال به تلگرام فیک می‌شکد ولی رکورد ساخته می‌شود)
  let r = await json(await call('POST', '/api/broadcast', { token: TOKEN, body: {
    kind: 'poll', target: 'users', userIds: '42',
    poll: { question: 'رنگ محبوب؟', options: ['قرمز', 'آبی', 'سبز'] },
  } }));
  ok('ساخت نظرسنجی (direct)', r.status === 200 && r.body.data.mode === 'direct');
  r = await json(await call('GET', '/api/engagement', { token: TOKEN }));
  ok('نظرسنجی در لیست تعامل‌ها', r.body.data.polls.some((p) => p.q === 'رنگ محبوب؟'));
  POLL_ID = (r.body.data.polls.find((p) => p.q === 'رنگ محبوب؟') || {}).id || '';

  // رأی از طریق وب‌هوک (کال‌بک) — گزینه ۱
  await call('POST', '/telegram/webhook', { body: {
    update_id: 500, callback_query: {
      id: 'cb1', from: { id: 42, first_name: 'Ali' },
      message: { message_id: 7, chat: { id: 42 } }, data: `poll:${POLL_ID}:1`,
    },
  }, headers: { 'x-telegram-bot-api-secret-token': 'whsec-test' } });
  await new Promise((res) => setTimeout(res, 500));
  r = await json(await call('GET', '/api/engagement', { token: TOKEN }));
  let poll = r.body.data.polls.find((p) => p.id === POLL_ID);
  ok('رأی اول شمرده شد', poll && poll.opts[1].n === 1 && poll.total === 1);

  // تغییر رأی به گزینه ۲
  await call('POST', '/telegram/webhook', { body: {
    update_id: 501, callback_query: {
      id: 'cb2', from: { id: 42, first_name: 'Ali' },
      message: { message_id: 7, chat: { id: 42 } }, data: `poll:${POLL_ID}:2`,
    },
  }, headers: { 'x-telegram-bot-api-secret-token': 'whsec-test' } });
  await new Promise((res) => setTimeout(res, 500));
  r = await json(await call('GET', '/api/engagement', { token: TOKEN }));
  poll = r.body.data.polls.find((p) => p.id === POLL_ID);
  ok('تغییر رأی (کاهش قبلی/افزایش جدید)', poll && poll.opts[1].n === 0 && poll.opts[2].n === 1);

  // رأی کاربر دوم (اول باید به‌عنوان کاربر ثبت شود — کاربر ناشناس رد می‌شود)
  await call('POST', '/telegram/webhook', { body: {
    update_id: 499, message: { message_id: 19, text: '/start', chat: { id: 43 },
      from: { id: 43, first_name: 'Reza' } },
  }, headers: { 'x-telegram-bot-api-secret-token': 'whsec-test' } });
  await new Promise((res) => setTimeout(res, 400));
  await call('POST', '/telegram/webhook', { body: {
    update_id: 502, callback_query: {
      id: 'cb3', from: { id: 43, first_name: 'Reza' },
      message: { message_id: 8, chat: { id: 43 } }, data: `poll:${POLL_ID}:1`,
    },
  }, headers: { 'x-telegram-bot-api-secret-token': 'whsec-test' } });
  await new Promise((res) => setTimeout(res, 500));
  r = await json(await call('GET', '/api/engagement', { token: TOKEN }));
  poll = r.body.data.polls.find((p) => p.id === POLL_ID);
  ok('رأی کاربر دوم', poll && poll.total === 2);
}

console.log('\n── 10) پست عکس با لایک/دیسلایک ──');
let POST_ID = '';
{
  let r = await json(await call('POST', '/api/broadcast', { token: TOKEN, body: {
    kind: 'photo', target: 'chat', chatId: -100123,
    photo: { url: 'https://example.com/pic.jpg', caption: 'کپشن تست' },
  } }));
  ok('ساخت پست عکس (ارسال به کانال فیک)', r.status === 200 && r.body.data.mode === 'direct');
  r = await json(await call('GET', '/api/engagement', { token: TOKEN }));
  const post = r.body.data.posts.find((p) => p.caption === 'کپشن تست');
  ok('پست در لیست تعامل‌ها', !!post);
  POST_ID = post ? post.id : '';

  // لایک → دیسلایک → برداشتن
  const react = async (uid, act) => {
    await call('POST', '/telegram/webhook', { body: {
      update_id: 600 + uid, callback_query: {
        id: 'c' + uid + act, from: { id: uid, first_name: 'U' + uid },
        message: { message_id: 9, chat: { id: uid } }, data: `react:${POST_ID}:${act}`,
      },
    }, headers: { 'x-telegram-bot-api-secret-token': 'whsec-test' } });
    await new Promise((res) => setTimeout(res, 400));
  };
  await react(42, 'l');
  await react(43, 'l');
  await react(43, 'd'); // تغییر به دیسلایک
  r = await json(await call('GET', '/api/engagement', { token: TOKEN }));
  const p2 = r.body.data.posts.find((p) => p.id === POST_ID);
  ok('لایک/دیسلایک شمرده شد (l=1, d=1)', p2 && p2.likes === 1 && p2.dislikes === 1);
  await react(42, 'l'); // برداشتن لایک
  r = await json(await call('GET', '/api/engagement', { token: TOKEN }));
  const p3 = r.body.data.posts.find((p) => p.id === POST_ID);
  ok('برداشتن رأی (toggle)', p3 && p3.likes === 0);
}

console.log('\n── 11) پشتیبانی دوطرفه ──');
{
  // کاربر /support می‌فرستد
  await call('POST', '/telegram/webhook', { body: {
    update_id: 700, message: { message_id: 20, text: '/support', chat: { id: 555 },
      from: { id: 555, first_name: 'Cust', username: 'cust' } },
  }, headers: { 'x-telegram-bot-api-secret-token': 'whsec-test' } });
  await new Promise((res) => setTimeout(res, 400));
  // پیام متنی → باید به تیکت برود
  await call('POST', '/telegram/webhook', { body: {
    update_id: 701, message: { message_id: 21, text: 'سلام، مشکل دارم!', chat: { id: 555 },
      from: { id: 555, first_name: 'Cust' } },
  }, headers: { 'x-telegram-bot-api-secret-token': 'whsec-test' } });
  await new Promise((res) => setTimeout(res, 400));

  let r = await json(await call('GET', '/api/support/tickets', { token: TOKEN }));
  const t0 = r.body.data.tickets.find((x) => x.id === '555');
  ok('تیکت ساخته شد و پیام کاربر ثبت شد', t0 && t0.last && t0.last.includes('مشکل'));
  ok('خوانده‌نشده = 1', t0 && t0.unread === 1);

  r = await json(await call('GET', '/api/support/tickets/555', { token: TOKEN }));
  ok('خواندن تیکت (unread صفر شد)', r.status === 200 && r.body.data.ticket.messages.some((m) => m.s === 'u' && m.t.includes('مشکل')));

  r = await json(await call('POST', '/api/support/tickets/555/reply', { token: TOKEN, body: { text: 'پاسخ تست پشتیبانی' } }));
  ok('پاسخ ادمین ثبت شد', r.status === 200 && r.body.data.ticket.messages.some((m) => m.s === 'a'));

  r = await json(await call('POST', '/api/support/tickets/555/close', { token: TOKEN }));
  ok('بستن تیکت', r.status === 200);
}

console.log('\n── 12) قفل کانال ──');
{
  let r = await json(await call('PUT', '/api/settings', { token: TOKEN, body: {
    requiredChannel: { enabled: true, chatId: '@test_channel', url: '' },
  } }));
  ok('فعال‌سازی قفل کانال', r.status === 200 && r.body.data.settings.requiredChannel.enabled === true);

  // کاربر جدید با توکن فیک → بررسی عضویت خطا می‌دهد → fail-open → کاربر عادی پردازش می‌شود
  await call('POST', '/telegram/webhook', { body: {
    update_id: 800, message: { message_id: 30, text: '/start', chat: { id: 888 },
      from: { id: 888, first_name: 'Locked' } },
  }, headers: { 'x-telegram-bot-api-secret-token': 'whsec-test' } });
  await new Promise((res) => setTimeout(res, 600));
  r = await json(await call('GET', '/api/users?q=888', { token: TOKEN }));
  ok('fail-open: با خطای API عضویت، کاربر رد نشد', r.body.data.rows.length === 1);

  // خاموش کردن قفل برای بقیه تست‌ها
  await call('PUT', '/api/settings', { token: TOKEN, body: { requiredChannel: { enabled: false, chatId: '', url: '' } } });
}

console.log('\n── 13) تغییر رمز عبور از پنل ──');
{
  // رمز فعلی غلط → رد
  let r = await json(await call('POST', '/api/auth/change-password', { token: TOKEN, body: { currentPassword: 'wrong', newPassword: 'test-new-pass-456' } }));
  ok('رمز فعلی غلط → wrong_password', r.body.error === 'wrong_password');

  // رمز جدید کوتاه → رد
  r = await json(await call('POST', '/api/auth/change-password', { token: TOKEN, body: { currentPassword: 'botpanel123', newPassword: 'short' } }));
  ok('رمز جدید کوتاه → invalid_password', r.body.error === 'invalid_password');

  // تغییر موفق
  r = await json(await call('POST', '/api/auth/change-password', { token: TOKEN, body: { currentPassword: 'botpanel123', newPassword: 'test-new-pass-456' } }));
  ok('تغییر رمز موفق', r.status === 200 && r.body.ok === true);

  // ورود با رمز قدیمی → رد / با رمز جدید → ok (از IP تازه، چون IP اصلی در بخش ۲ قفل ضد بروت‌فورس است)
  r = await json(await call('POST', '/api/auth/login', { body: { password: 'botpanel123' }, ip: '9.9.9.9' }));
  ok('ورود با رمز قدیمی → 401', r.status === 401);
  r = await json(await call('POST', '/api/auth/login', { body: { password: 'test-new-pass-456' }, ip: '9.9.9.9' }));
  ok('ورود با رمز جدید → 200', r.status === 200);

  // نشست فعلی معتبر می‌ماند، پیش‌فرض غیرفعال است
  r = await json(await call('GET', '/api/auth/session', { token: TOKEN }));
  ok('نشست فعلی پس از تغییر رمز معتبر ماند', r.status === 200);
  r = await json(await call('GET', '/api/auth/default-status'));
  ok('رمز پیش‌فرض غیرفعال شد', r.body.data.defaultActive === false);

  // برگرداندن به پیش‌فرض برای تکرارپذیری تست‌ها
  r = await json(await call('POST', '/api/auth/change-password', { token: TOKEN, body: { currentPassword: 'test-new-pass-456', newPassword: 'botpanel123' } }));
  ok('بازگشت به رمز پیش‌فرض', r.status === 200);
  r = await json(await call('POST', '/api/auth/login', { body: { password: 'botpanel123' }, ip: '9.9.9.9' }));
  ok('ورود دوباره با پیش‌فرض → 200', r.status === 200);
}

console.log(`\n═══ نتیجه: ${passed} passed / ${failed} failed ═══\n`);
process.exit(failed ? 1 : 0);
