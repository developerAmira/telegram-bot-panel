
import { Hono } from 'hono';
import { handleUpdate } from './telegram.js';
import authRoutes from './routes/auth.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import usersRoutes from './routes/users.routes.js';
import broadcastRoutes from './routes/broadcast.routes.js';
import engagementRoutes from './routes/engagement.routes.js';
import supportRoutes from './routes/support.routes.js';
import menuRoutes from './routes/menu.routes.js';
import settingsRoutes from './routes/settings.routes.js';

const api = new Hono().basePath('/api');

api.route('/auth', authRoutes);
api.route('/dashboard', dashboardRoutes);
api.route('/users', usersRoutes);
api.route('/broadcast', broadcastRoutes);
api.route('/engagement', engagementRoutes);
api.route('/support', supportRoutes);
api.route('/menu', menuRoutes);
api.route('/settings', settingsRoutes);

api.get('/health', (c) =>
  c.json({ ok: true, data: { ts: Date.now(), colo: c.req.raw.cf?.colo || null } })
);

api.notFound((c) => c.json({ ok: false, error: 'not_found' }, 404));
api.onError((err, c) => {
  console.error('[api] unhandled error:', err);
  return c.json({ ok: false, error: 'internal_error' }, 500);
});

const WEBHOOK_PATH = '/telegram/webhook';

async function handleWebhook(request, env, ctx) {
  const secret = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let update = null;
  try { update = await request.json(); } catch {   }
  if (!update || typeof update !== 'object') {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  ctx.waitUntil(handleUpdate(env, update));
  return Response.json({ ok: true });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === WEBHOOK_PATH) return handleWebhook(request, env, ctx);
    if (pathname.startsWith('/api/')) return api.fetch(request, env, ctx);

    if (env.ASSETS && request.method === 'GET') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
