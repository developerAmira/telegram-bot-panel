// ═══════════════════════════════════════════════════════════════════
//  kv.js — لایه دسترسی به داده (Data Access Layer) روی Cloudflare KV
//
//  طرح کلیدها (Key Schema):
//   ┌──────────────────────┬────────────────────────────────────────┐
//   │ settings             │ تنظیمات ربات (JSON)                     │
//   │ menu                 │ منو/کیبوردهای ربات (JSON)               │
//   │ stats                │ شمارنده‌های آماری (JSON، تقریبی)          │
//   │ recent_users         │ ۱۰ کاربر جدید (JSON آرایه)              │
//   │ user:{telegram_id}   │ رکورد کاربر (JSON + metadata فشرده)      │
//   │ session:{sha256}     │ نشست ادمین (با TTL)                     │
//   │ rl:{ip}              │ شمارنده محدودیت تلاش ورود (با TTL)       │
//   │ broadcast:{id}       │ جاب ارسال همگانی (JSON)                 │
//   │ broadcast:index      │ ۲۰ جاب اخیر (JSON آرایه)                │
//   └──────────────────────┴────────────────────────────────────────┘
//   نکته: metadata هر کلید کاربر (حداکثر ۱۰۲۴ بایت) برای لیست‌گیری
//   بدون خواندن مجزا استفاده می‌شود — لیست کاربران و ارسال همگانی
//   بدون نیاز به ایندکس جانبی کار می‌کنند (بدون race condition).
// ═══════════════════════════════════════════════════════════════════

export const K = {
  SETTINGS: 'settings',
  MENU: 'menu',
  STATS: 'stats',
  RECENT_USERS: 'recent_users',
  USER: (id) => `user:${id}`,
  USER_PREFIX: 'user:',
  SESSION: (hash) => `session:${hash}`,
  SESSION_PREFIX: 'session:',
  LOGIN_RL: (ip) => `rl:${ip}`,
  BROADCAST: (id) => `broadcast:${id}`,
  BROADCAST_INDEX: 'broadcast:index',
};

// ── مقادیر پیش‌فرض منو (قابل ویرایش از پنل) ─────────────────────────
export const DEFAULT_MENU = {
  welcome: {
    fa: 'سلام {name} عزیز 👋\nبه ربات ما خوش آمدید!\nاز دکمه‌های زیر استفاده کنید.',
    en: 'Hello {name} 👋\nWelcome to our bot!\nUse the buttons below.',
  },
  help: {
    fa: '🤖 راهنمای ربات\n\n/start — شروع و نمایش منو\n/help — نمایش همین راهنما\n/lang — تغییر زبان\n/id — نمایش آیدی عددی شما\n/ping — بررسی فعال بودن',
    en: '🤖 Bot Help\n\n/start — Start & show the menu\n/help — Show this help\n/lang — Change language\n/id — Show your numeric ID\n/ping — Check the bot is alive',
  },
  // کیبورد اصلی (Reply Keyboard) — آرایه‌ای از ردیف‌ها
  mainKeyboard: [['/start', '/help'], ['/lang', '/id']],
  // دکمه‌های شیشه‌ای (Inline) زیر پیام خوش‌آمد
  // type: 'url' (باز کردن لینک) یا 'callback' (فراخوانی در ربات)
  inlineButtons: [
    [{ text: '🌐 وب‌سایت | Website', type: 'url', value: 'https://example.com' }],
    [{ text: '🌍 تغییر زبان | Language', type: 'callback', value: 'setlang:menu' }],
  ],
};

// ── مقادیر پیش‌فرض تنظیمات ─────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  botToken: '', // اگر خالی باشد از env.BOT_TOKEN استفاده می‌شود
  adminIds: [], // آیدی عددی ادمین‌های ربات (نه پنل)
  defaultLang: 'fa',
  broadcast: { batchSize: 25, delayMs: 40 }, // تنظیمات Rate-Limit ارسال همگانی
};

// ═══════════════ پریمیتیوها ═══════════════

export async function getJson(env, key, fallback = null) {
  const raw = await env.BOT_KV.get(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export async function putJson(env, key, value, opts = {}) {
  const o = {};
  if (opts.ttl) o.expirationTtl = Math.max(opts.ttl, 60); // حداقل TTL مجاز KV: ۶۰ ثانیه
  if (opts.meta) o.metadata = opts.meta;
  await env.BOT_KV.put(key, JSON.stringify(value), o);
}

export async function del(env, key) {
  await env.BOT_KV.delete(key);
}

const deepClone = (v) => JSON.parse(JSON.stringify(v));

// ═══════════════ تنظیمات ربات ═══════════════

export async function getSettings(env) {
  const s = (await getJson(env, K.SETTINGS, {})) || {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    broadcast: { ...DEFAULT_SETTINGS.broadcast, ...(s.broadcast || {}) },
  };
}

export async function saveSettings(env, settings) {
  await putJson(env, K.SETTINGS, settings);
}

// ═══════════════ منو و کیبوردها ═══════════════

export function withMenuDefaults(menu = {}) {
  return {
    welcome: {
      fa: menu?.welcome?.fa ?? DEFAULT_MENU.welcome.fa,
      en: menu?.welcome?.en ?? DEFAULT_MENU.welcome.en,
    },
    help: {
      fa: menu?.help?.fa ?? DEFAULT_MENU.help.fa,
      en: menu?.help?.en ?? DEFAULT_MENU.help.en,
    },
    mainKeyboard: Array.isArray(menu?.mainKeyboard) && menu.mainKeyboard.length
      ? menu.mainKeyboard
      : deepClone(DEFAULT_MENU.mainKeyboard),
    inlineButtons: Array.isArray(menu?.inlineButtons) && menu.inlineButtons.length
      ? menu.inlineButtons
      : deepClone(DEFAULT_MENU.inlineButtons),
  };
}

export async function getMenu(env) {
  return withMenuDefaults(await getJson(env, K.MENU, {}));
}

export async function saveMenu(env, menu) {
  await putJson(env, K.MENU, menu);
}

// ═══════════════ کاربران ═══════════════

// metadata فشرده کنار هر کلید کاربر — مبنای لیست/جستجو/هدف‌گیری
// n=نام، u=یوزرنیم، j=عضویت، s=آخرین فعالیت، l=زبان، b=مسدود، x=بات را بلاک کرده
export function userMetadata(u) {
  return {
    n: String(u.firstName || '').slice(0, 64),
    u: String(u.username || '').slice(0, 64),
    j: u.joinedAt || 0,
    s: u.lastSeen || 0,
    l: String(u.lang || '').slice(0, 8),
    b: u.banned ? 1 : 0,
    x: u.blockedBot ? 1 : 0,
  };
}

export async function getUser(env, id) {
  return getJson(env, K.USER(String(id)));
}

export async function putUser(env, user) {
  return putJson(env, K.USER(String(user.id)), user, { meta: userMetadata(user) });
}

// یک صفحه از لیست کاربران با cursor بومی KV (مرتب‌شده بر اساس کلید)
export async function listUsersPage(env, { cursor, limit = 20 } = {}) {
  const res = await env.BOT_KV.list({
    prefix: K.USER_PREFIX,
    cursor: cursor || undefined,
    limit: Math.min(Math.max(limit, 1), 1000),
  });
  const rows = res.keys.map((k) => {
    const m = k.metadata || {};
    return {
      id: k.name.slice(K.USER_PREFIX.length),
      firstName: m.n || '',
      username: m.u || '',
      joinedAt: m.j || 0,
      lastSeen: m.s || 0,
      lang: m.l || '',
      banned: !!m.b,
      blockedBot: !!m.x,
    };
  });
  return { rows, nextCursor: res.list_complete ? null : res.cursor || null };
}

// جستجوی کاربر (نام/یوزرنیم/آیدی) — حداکثر ۱۰ صفحه از KV را اسکن می‌کند
export async function searchUsers(env, q, maxResults = 50, maxPages = 10) {
  const needle = q.toLowerCase();
  const out = [];
  let cursor;
  for (let i = 0; i < maxPages && out.length < maxResults; i++) {
    const res = await env.BOT_KV.list({ prefix: K.USER_PREFIX, cursor, limit: 1000 });
    for (const k of res.keys) {
      const m = k.metadata || {};
      const id = k.name.slice(K.USER_PREFIX.length);
      const hit =
        id === needle ||
        String(m.n || '').toLowerCase().includes(needle) ||
        String(m.u || '').toLowerCase().includes(needle);
      if (hit) {
        out.push({
          id, firstName: m.n || '', username: m.u || '', joinedAt: m.j || 0,
          lastSeen: m.s || 0, lang: m.l || '', banned: !!m.b, blockedBot: !!m.x,
        });
        if (out.length >= maxResults) break;
      }
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return out;
}

// جمع‌آوری آیدی کاربران هدف برای ارسال همگانی (مسدودشده‌ها و بلاک‌کنندگان حذف می‌شوند)
export async function collectTargetIds(env, withinDays = 0) {
  const ids = [];
  const minLastSeen = withinDays > 0 ? Date.now() - withinDays * 86400000 : 0;
  let cursor;
  do {
    const res = await env.BOT_KV.list({ prefix: K.USER_PREFIX, cursor, limit: 1000 });
    for (const k of res.keys) {
      const m = k.metadata || {};
      if (m.b || m.x) continue; // مسدود یا بات را بلاک کرده
      if (minLastSeen && (m.s || 0) < minLastSeen) continue; // غیرفعال
      ids.push(k.name.slice(K.USER_PREFIX.length));
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  return ids;
}

// ═══════════════ آمار (شمارنده‌های تقریبی — KV عملیات اتمیک ندارد) ═══════════════

export const getStats = (env) =>
  getJson(env, K.STATS, { users: 0, banned: 0, messages: 0, broadcasts: 0, sent: 0 });

export async function bumpStats(env, patch) {
  const s = await getStats(env);
  for (const k of Object.keys(patch)) s[k] = (s[k] || 0) + patch[k];
  await putJson(env, K.STATS, s);
  return s;
}

// ═══════════════ کاربران اخیر (ring buffer کوچک) ═══════════════

export async function pushRecentUser(env, id) {
  const arr = (await getJson(env, K.RECENT_USERS, [])) || [];
  arr.unshift(String(id));
  await putJson(env, K.RECENT_USERS, [...new Set(arr)].slice(0, 10));
}

export async function getRecentUsers(env) {
  const ids = (await getJson(env, K.RECENT_USERS, [])) || [];
  const users = await Promise.all(ids.map((id) => getUser(env, id)));
  return users.filter(Boolean).map((u) => ({
    id: u.id, firstName: u.firstName || '', username: u.username || '',
    lang: u.lang || '', joinedAt: u.joinedAt || 0, banned: !!u.banned,
  }));
}

// ═══════════════ ارسال همگانی ═══════════════

export async function pushBroadcastId(env, id) {
  const arr = (await getJson(env, K.BROADCAST_INDEX, [])) || [];
  arr.unshift(id);
  await putJson(env, K.BROADCAST_INDEX, [...new Set(arr)].slice(0, 20));
}

export async function getRecentBroadcasts(env) {
  const ids = (await getJson(env, K.BROADCAST_INDEX, [])) || [];
  const jobs = await Promise.all(ids.map((id) => getJson(env, K.BROADCAST(id))));
  return jobs
    .filter(Boolean)
    .map((j) => ({ ...j, targets: undefined })) // لیست، بدون آرایه سنگین targets
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
