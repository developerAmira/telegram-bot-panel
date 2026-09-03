// ═══════════════════════════════════════════════════════════════════
//  auth.js — احراز هویت ادمین پنل
//
//  🔐 نکات امنیتی پیاده‌سازی‌شده:
//   • رمز عبور در KV ذخیره می‌شود (فقط هش SHA-256) و از داخل پنل قابل تغییر است
//   • رمز پیش‌فرض اولیه: DEFAULT_ADMIN_PASSWORD — تا زمانی که از پنل عوض نشود
//   • مقایسه رمز به‌صورت timing-safe (هش هر دو طرف سپس XOR)
//   • توکن نشست تصادفی ۳۲ بایتی؛ در KV فقط «هش SHA-256» توکن ذخیره می‌شود
//   • محدودیت نرخ ورود: حداکثر ۵ تلاش ناموفق در ۱۰ دقیقه به‌ازای IP
//   • پس از تغییر رمز، همه نشست‌های دیگر بی‌اعتبار می‌شوند
// ═══════════════════════════════════════════════════════════════════

import { K, getJson, putJson, del } from './kv.js';

const SESSION_TTL = 7 * 24 * 3600; // ۷ روز (ثانیه)
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_SEC = 600; // ۱۰ دقیقه

// ⚠️ رمز پیش‌فرض ورود — در README مستند شده؛ بعد از اولین ورود از پنل تغییر دهید
export const DEFAULT_ADMIN_PASSWORD = 'botpanel123';

// کلید KV نگهدارنده هش رمز پنل
const K_ADMIN_AUTH = 'admin_auth';

// ── ابزارهای رمزنگاری ──────────────────────────────────────────────

export async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// مقایسه زمان-ثابت: ابتدا هر دو رشته هش می‌شوند تا طول هم تراز شود
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256hex(String(a)), sha256hex(String(b))]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── مدیریت رمز عبور پنل (در KV) ───────────────────────────────────

// رکورد رمز: {hash, updatedAt} — اگر نبود یعنی هنوز رمز پیش‌فرض فعال است
async function getPasswordRecord(env) {
  return getJson(env, K_ADMIN_AUTH);
}

// آیا هنوز رمز پیش‌فرض فعال است؟ (برای نمایش راهنمای صفحه ورود)
export async function isDefaultPasswordActive(env) {
  const rec = await getPasswordRecord(env);
  return !(rec && rec.hash);
}

// تغییر رمز پنل (هش ذخیره می‌شود، نه خود رمز)
export async function setAdminPassword(env, newPassword) {
  const hash = await sha256hex(String(newPassword));
  await putJson(env, K_ADMIN_AUTH, { hash, updatedAt: Date.now() });
}

// بازنشانی به پیش‌فرض (اگر ادمین کلید KV را دستی حذف کند هم همین اثر را دارد)
export async function resetAdminPassword(env) {
  await del(env, K_ADMIN_AUTH);
}

// اعتبارسنجی رمز: اگر رمزی ست شده باشد همان، وگرنه رمز پیش‌فرض
export async function verifyAdminPassword(env, password) {
  const rec = await getPasswordRecord(env);
  const targetHash = (rec && rec.hash) || (await sha256hex(DEFAULT_ADMIN_PASSWORD));
  return safeEqual(await sha256hex(String(password)), targetHash);
}

// ── نشست‌ها ────────────────────────────────────────────────────────

export async function createSession(env) {
  const token = randomToken();
  const hash = await sha256hex(token);
  const expiresAt = Date.now() + SESSION_TTL * 1000;
  await putJson(env, K.SESSION(hash), { createdAt: Date.now(), expiresAt }, { ttl: SESSION_TTL });
  return { token, expiresAt };
}

export async function validateSession(env, token) {
  if (!token || token.length < 32) return null;
  const s = await getJson(env, K.SESSION(await sha256hex(token)));
  if (!s || !s.expiresAt || s.expiresAt < Date.now()) return null;
  return s;
}

export async function deleteSession(env, token) {
  if (!token) return;
  await del(env, K.SESSION(await sha256hex(token)));
}

// حذف همه نشست‌ها به‌جز نشست فعلی (پس از تغییر رمز)
export async function deleteAllSessions(env, keepToken) {
  const keepHash = keepToken ? await sha256hex(keepToken) : null;
  let cursor;
  do {
    const res = await env.BOT_KV.list({ prefix: K.SESSION_PREFIX, cursor, limit: 1000 });
    for (const k of res.keys) {
      const hash = k.name.slice(K.SESSION_PREFIX.length);
      if (hash !== keepHash) await del(env, k.name);
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
}

// ── محدودیت نرخ ورود (Rate limiting) ───────────────────────────────

export async function loginAllowed(env, ip) {
  const c = await getJson(env, K.LOGIN_RL(ip));
  return { allowed: !c || (c.count || 0) < LOGIN_MAX_FAILS, count: (c && c.count) || 0 };
}

export async function loginFailed(env, ip) {
  const c = (await getJson(env, K.LOGIN_RL(ip))) || { count: 0 };
  await putJson(env, K.LOGIN_RL(ip), { count: c.count + 1 }, { ttl: LOGIN_WINDOW_SEC });
}

export async function loginSucceeded(env, ip) {
  await del(env, K.LOGIN_RL(ip)); // پاک‌سازی شمارنده پس از ورود موفق
}

// ── میان‌افزار Hono ─────────────────────────────────────────────────

export async function requireAuth(c, next) {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const session = token ? await validateSession(c.env, token) : null;
  if (!session) return c.json({ ok: false, error: 'unauthorized' }, 401);
  c.set('session', session);
  c.set('token', token);
  await next();
}
