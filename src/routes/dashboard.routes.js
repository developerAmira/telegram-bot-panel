
import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { getStats, getRecentUsers } from '../kv.js';
import { resolveToken, tgApi, withTimeout } from '../telegram.js';

const r = new Hono();
r.use('*', requireAuth);

r.get('/stats', async (c) => {
  const env = c.env;

  const [stats, recentUsers] = await Promise.all([getStats(env), getRecentUsers(env)]);

  let webhook = { configured: false };
  const token = await resolveToken(env);
  if (token) {
    const info = await withTimeout(tgApi(token, 'getWebhookInfo'), 6000, null);
    if (info && info.ok && info.result) {
      webhook = {
        configured: !!info.result.url,
        url: info.result.url || '',
        pending: info.result.pending_update_count || 0,
        lastError: info.result.last_error_message || '',
        lastErrorDate: info.result.last_error_date || 0,
      };
    } else if (info) {
      webhook = { configured: true, error: info.description || 'telegram_error' };
    } else {
      webhook = { configured: true, error: 'timeout' };
    }
  }

  return c.json({
    ok: true,
    data: { stats, recentUsers, webhook, version: env.APP_VERSION || '-', ts: Date.now() },
  });
});

export default r;
