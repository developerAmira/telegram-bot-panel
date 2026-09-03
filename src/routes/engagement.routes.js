
import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { getEngagementLists } from '../kv.js';

const r = new Hono();
r.use('*', requireAuth);

r.get('/', async (c) => {
  const data = await getEngagementLists(c.env);
  return c.json({ ok: true, data });
});

export default r;
