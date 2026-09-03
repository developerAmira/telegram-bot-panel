// ═══════════════════════════════════════════════════════════════════
//  kv.js — لایه دسترسی به داده (Data Access Layer) روی Cloudflare KV
//
//  طرح کلیدها (Key Schema):
//   settings             تنظیمات ربات + قفل کانال (JSON)
//   menu                 منو/کیبوردها + زیرمنوهای چندلایه (JSON)
//   stats                شمارنده‌های آماری (JSON، تقریبی)
//   recent_users         ۱۰ کاربر جدید (JSON آرایه)
//   user:{telegram_id}   رکورد کاربر (JSON + metadata فشرده)
//   session:{sha256}     نشست ادمین (با TTL)
//   rl:{ip}              شمارنده محدودیت تلاش ورود (با TTL)
//   broadcast:{id}       جاب ارسال (متن/نظرسنجی/عکس) (JSON)
//   broadcast:index      ۲۰ جاب اخیر (JSON آرایه)
//   poll:{id}            نظرسنجی تعاملی + آرا (JSON)
//   post:{id}            پست عکس با لایک/دیسلایک + واکنش‌ها (JSON)
//   eng:index            ایندکس نظرسنجی‌ها/پست‌های اخیر (JSON آرایه)
//   ticket:{userId}      تیکت پشتیبانی کاربر + پیام‌ها (JSON)
//   tickets:index        خلاصه تیکت‌ها برای صندوق پنل (JSON آرایه)
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
  POLL: (id) => `poll:${id}`,
  POST: (id) => `post:${id}`,
  ENG_INDEX: 'eng:index',
  TICKET: (id) => `ticket:${id}`,
  TICKETS_INDEX: 'tickets:index',
};

// ── مقادیر پیش‌فرض منو (قابل ویرایش از پنل) ─────────────────────────
// انواع دکمه شیشه‌ای: url (لینک) | callback (کال‌بک) | submenu (زیرمنو) | text (پاپ‌آپ متن)
export const DEFAULT_MENU = {
  welcome: {
    fa: 'سلام {name} عزیز 👋\nبه ربات ما خوش آمدید!\nاز دکمه‌های زیر استفاده کنید.',
    en: 'Hello {name} 👋\nWelcome to our bot!\nUse the buttons below.',
  },
  help: {
    fa: '🤖 راهنمای ربات\n\n/start — شروع و نمایش منو\n/help — نمایش همین راهنما\n/lang — تغییر زبان\n/id — نمایش آیدی عددی شما\n/support — پیام به پشتیبانی\n/end — پایان گفتگو با پشتیبانی\n/ping — بررسی فعال بودن',
    en: '🤖 Bot Help\n\n/start — Start & show the menu\n/help — Show this help\n/lang — Change language\n/id — Show your numeric ID\n/support — Message the support team\n/end — End the support chat\n/ping — Check the bot is alive',
  },
  // کیبورد اصلی (Reply Keyboard) — آرایه‌ای از ردیف‌ها
  mainKeyboard: [['/start', '/help'], ['/lang', '/id'], ['/support']],
  // دکمه‌های شیشه‌ای (Inline) زیر پیام خوش‌آمد
  inlineButtons: [
    [{ text: '🛍 فروشگاه | Shop', type: 'submenu', value: 'shop' }],
    [{ text: '🌐 وب‌سایت | Website', type: 'url', value: 'https://example.com' }],
    [{ text: '🌍 تغییر زبان | Language', type: 'callback', value: 'setlang:menu' }],
    [{ text: '🛡 پشتیبانی | Support', type: 'callback', value: 'support:open' }],
  ],
  // ── زیرمنوهای چندلایه — هر زیرمنو می‌تواند دکمه‌هایی به زیرمنوی دیگر هم داشته باشد ──
  submenus: {
    shop: {
      title: '🛍 فروشگاه',
      text: 'یکی از گزینه‌های زیر را انتخاب کنید:',
      buttons: [
        [{ text: '📄 لیست قیمت', type: 'text', value: 'لیست قیمت‌ها به‌زودی به‌روزرسانی می‌شود!\nبرای اطلاع از تخفیف‌ها در کانال عضو شوید.' }],
        [{ text: '📱 پشتیبانی محصولات', type: 'submenu', value: 'shop_support' }],
        [{ text: '🌐 سایت کامل', type: 'url', value: 'https://example.com' }],
      ],
    },
    shop_support: {
      title: '📱 پشتیبانی محصولات',
      text: 'چه مشکلی دارید؟',
      buttons: [
        [{ text: '💬 گفتگو با پشتیبانی', type: 'callback', value: 'support:open' }],
        [{ text: '⬅️ بازگشت به فروشگاه', type: 'submenu', value: 'shop' }],
      ],
    },
  },
};

// ── مقادیر پیش‌فرض تنظیمات ─────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  botToken: '', // اگر خالی باشد از env.BOT_TOKEN استفاده می‌شود
  botLangMode: 'both', // 'fa' | 'en' | 'both' — دوزبانه یا تک‌زبانه
  defaultLang: 'fa', // زبان اولیه کاربران جدید (فقط در حالت دوزبانه)
  supportButton: { enabled: true, fa: '🛡 پشتیبانی', en: '🛡 Support' }, // دکمه پشتیبانی همیشگی در همه صفحات منو

  broadcast: { batchSize: 25, delayMs: 40 }, // تنظیمات Rate-Limit ارسال همگانی
  // قفل کانال: کاربر تا عضو کانال نشود ربات برایش فعال نمی‌شود
  requiredChannel: { enabled: false, chatId: '', url: '' },
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
  delete s.adminIds; // فیلد قدیمی — مدیریت فقط از پنل وب است
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    broadcast: { ...DEFAULT_SETTINGS.broadcast, ...(s.broadcast || {}) },
    requiredChannel: { ...DEFAULT_SETTINGS.requiredChannel, ...(s.requiredChannel || {}) },
    supportButton: { ...DEFAULT_SETTINGS.supportButton, ...(s.supportButton || {}) },
  };
}

export async function saveSettings(env, settings) {
  await putJson(env, K.SETTINGS, settings);
}

// ═══════════════ منو و کیبوردها ═══════════════

export function withMenuDefaults(menu = {}) {
  const submenus = {};
  if (menu.submenus && typeof menu.submenus === 'object') {
    for (const [id, sm] of Object.entries(menu.submenus)) {
      if (!sm || typeof sm !== 'object') continue;
      submenus[id] = {
        title: String(sm.title || '').slice(0, 64),
        text: String(sm.text || '').slice(0, 3500),
        buttons: Array.isArray(sm.buttons) ? sm.buttons : [],
      };
    }
  }
  return {
    welcome: {
      fa: menu?.welcome?.fa ?? DEFAULT_MENU.welcome.fa,
      en: menu?.welcome?.en ?? DEFAULT_MENU.welcome.en,
    },
    help: {
      fa: menu?.help?.fa ?? DEFAULT_MENU.help.fa,
      en: menu?.help?.en ?? DEFAULT_MENU.help.en,
    },
    inlineButtons: Array.isArray(menu?.inlineButtons) && menu.inlineButtons.length
      ? menu.inlineButtons
      : deepClone(DEFAULT_MENU.inlineButtons),
    submenus: Object.keys(submenus).length ? submenus : deepClone(DEFAULT_MENU.submenus),
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

// ═══════════════ آمار ═══════════════

export const getStats = (env) =>
  getJson(env, K.STATS, { users: 0, banned: 0, messages: 0, broadcasts: 0, sent: 0 });

export async function bumpStats(env, patch) {
  const s = await getStats(env);
  for (const k of Object.keys(patch)) s[k] = (s[k] || 0) + patch[k];
  await putJson(env, K.STATS, s);
  return s;
}

// ═══════════════ کاربران اخیر ═══════════════

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

// ═══════════════ ارسال (متن/نظرسنجی/عکس) ═══════════════

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
    .map((j) => ({ ...j, targets: undefined }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ═══════════════ نظرسنجی‌های تعاملی ═══════════════

export const getPoll = (env, id) => getJson(env, K.POLL(id));
export const putPoll = (env, poll) => putJson(env, K.POLL(poll.id), poll);

export function pollTotals(poll) {
  const total = (poll.opts || []).reduce((a, o) => a + (o.n || 0), 0);
  return total;
}

// ═══════════════ پست‌های عکس با لایک/دیسلایک ═══════════════

export const getPost = (env, id) => getJson(env, K.POST(id));
export const putPost = (env, post) => putJson(env, K.POST(post.id), post);

// ═══════════════ ایندکس تعامل‌ها (نظرسنجی/پست) ═══════════════

export async function pushEngIndex(env, type, id) {
  const arr = (await getJson(env, K.ENG_INDEX, [])) || [];
  arr.unshift({ t: type, id, at: Date.now() });
  await putJson(env, K.ENG_INDEX, arr.slice(0, 50));
}

export async function getEngagementLists(env) {
  const idx = (await getJson(env, K.ENG_INDEX, [])) || [];
  const polls = [], posts = [];
  for (const e of idx) {
    if (e.t === 'poll' && polls.length < 20) {
      const p = await getPoll(env, e.id);
      if (p) polls.push({ id: p.id, q: p.q, opts: p.opts, total: pollTotals(p), createdAt: p.createdAt });
    }
    if (e.t === 'post' && posts.length < 20) {
      const p = await getPost(env, e.id);
      if (p) posts.push({ id: p.id, photo: p.photo, caption: p.caption, likes: p.likes || 0, dislikes: p.dislikes || 0, createdAt: p.createdAt });
    }
  }
  return { polls, posts };
}

// ═══════════════ تیکت‌های پشتیبانی ═══════════════

export const getTicket = (env, userId) => getJson(env, K.TICKET(String(userId)));

export async function putTicket(env, ticket) {
  ticket.messages = (ticket.messages || []).slice(-100); // حداکثر ۱۰۰ پیام آخر
  await putJson(env, K.TICKET(String(ticket.userId)), ticket);
}

// خلاصه تیکت در ایندکس صندوق پنل
async function upsertTicketIndex(env, ticket, { setRead = false, unreadDelta = 0 } = {}) {
  const arr = (await getJson(env, K.TICKETS_INDEX, [])) || [];
  let item = arr.find((x) => x.id === String(ticket.userId));
  if (!item) {
    item = { id: String(ticket.userId), name: '', last: '', unread: 0, open: true, updatedAt: 0 };
    arr.unshift(item);
  }
  item.name = ticket.userName || item.name;
  item.last = (ticket.messages || []).length
    ? String(ticket.messages[ticket.messages.length - 1].t).slice(0, 80)
    : item.last;
  item.open = ticket.open !== false;
  item.updatedAt = Date.now();
  if (setRead) item.unread = 0;
  else item.unread = Math.max(0, (item.unread || 0) + unreadDelta);
  arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  await putJson(env, K.TICKETS_INDEX, arr.slice(0, 100));
}

// ثبت پیام کاربر در تیکت (خوانده‌نشده برای ادمین)
export async function ticketAppendUser(env, user, text) {
  let t = await getTicket(env, user.id);
  if (!t) {
    t = { userId: String(user.id), userName: user.firstName || String(user.id), open: true, messages: [], createdAt: Date.now() };
  }
  t.open = true;
  t.userName = user.firstName || t.userName;
  t.messages.push({ s: 'u', t: String(text).slice(0, 3000), at: Date.now() });
  await putTicket(env, t);
  await upsertTicketIndex(env, t, { unreadDelta: 1 });
  return t;
}

// ثبت پاسخ ادمین (از پنل) + خوانده‌شدن
export async function ticketAppendAdmin(env, userId, text) {
  const t = await getTicket(env, userId);
  if (!t) return null;
  t.messages.push({ s: 'a', t: String(text).slice(0, 3000), at: Date.now() });
  await putTicket(env, t);
  await upsertTicketIndex(env, t, { setRead: true });
  return t;
}

export async function getTicketsList(env) {
  return (await getJson(env, K.TICKETS_INDEX, [])) || [];
}

export async function markTicketRead(env, userId) {
  const t = await getTicket(env, userId);
  if (!t) return;
  await upsertTicketIndex(env, t, { setRead: true });
}

export async function closeTicket(env, userId) {
  const t = await getTicket(env, userId);
  if (!t) return null;
  t.open = false;
  await putTicket(env, t);
  await upsertTicketIndex(env, t, { setRead: true });
  return t;
}

export async function ticketsUnreadCount(env) {
  const arr = (await getJson(env, K.TICKETS_INDEX, [])) || [];
  return arr.reduce((a, x) => a + (x.unread || 0), 0);
}
