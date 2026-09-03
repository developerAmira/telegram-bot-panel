// ═══════════════════════════════════════════════════════════════════
//  auth.js — احراز هویت ادمین پنل
//
//  🔐 نکات امنیتی پیاده‌سازی‌شده:
//   • رمز عبور فقط از Wrangler Secrets می‌آید (env.ADMIN_PASSWORD)
//   • مقایسه رمز به‌صورت timing-safe (هش SHA-256 هر دو طرف سپس XOR)
//   • توکن نشست تصادفی ۳۲ بایتی (crypto.getRandomValues)؛ در KV فقط
//     «هش SHA-256» توکن ذخیره می‌شود (لو رفتن KV ≠ لو رفتن نشست)
//   • محدودیت نرخ ورود: حداکثر ۵ تلاش ناموفق در ۱۰ دقیقه به‌ازای IP
//   • میان‌افزار requireAuth برای همه مسیرهای محافظت‌شده
// ═══════════════════════════════════════════════════════════════════

import { K, getJson, putJson, del } from './kv.js';

const SESSION_TTL = 7 * 24 * 3600; // ۷ روز (ثانیه)
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_SEC = 600; // ۱۰ دقیقه

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
