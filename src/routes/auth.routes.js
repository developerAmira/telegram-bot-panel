
import { Hono } from 'hono';
import {
  requireAuth, createSession, deleteSession, deleteAllSessions,
  loginAllowed, loginFailed, loginSucceeded,
  verifyAdminPassword, setAdminPassword, isDefaultPasswordActive,
} from '../auth.js';

const r = new Hono();

r.post('/login', async (c) => {
  const env = c.env;

  const ip = c.req.header('cf-connecting-ip') || 'local-dev';
  const rl = await loginAllowed(env, ip);
  if (!rl.allowed) {
    return c.json({ ok: false, error: 'rate_limited' }, 429);
  }

  let password = '';
  try { ({ password = '' } = await c.req.json()); } catch {   }

  const valid = await verifyAdminPassword(env, String(password));
  if (!valid) {
    await loginFailed(env, ip);
    return c.json({ ok: false, error: 'invalid_credentials' }, 401);
  }

  await loginSucceeded(env, ip);
  const session = await createSession(env);
  return c.json({ ok: true, data: session });
});

r.get('/default-status', async (c) =>
  c.json({ ok: true, data: { defaultActive: await isDefaultPasswordActive(c.env) } })
);

r.get('/session', requireAuth, (c) =>
  c.json({ ok: true, data: { valid: true, expiresAt: c.get('session').expiresAt } })
);

r.post('/logout', requireAuth, async (c) => {
  await deleteSession(c.env, c.get('token'));
  return c.json({ ok: true, data: { loggedOut: true } });
});

r.post('/change-password', requireAuth, async (c) => {
  const env = c.env;
  const body = await c.req.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');

  if (newPassword.length < 6) {
    return c.json({ ok: false, error: 'invalid_password' }, 400);
  }

  const ok = await verifyAdminPassword(env, currentPassword);
  if (!ok) {
    return c.json({ ok: false, error: 'wrong_password' }, 401);
  }

  await setAdminPassword(env, newPassword);
  await deleteAllSessions(env, c.get('token'));

  return c.json({ ok: true, data: { changed: true } });
});

export default r;
