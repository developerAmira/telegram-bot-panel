
import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { DEFAULT_MENU, getMenu, saveMenu, getSettings } from '../kv.js';
import { resolveToken, sendStart } from '../telegram.js';

const r = new Hono();
r.use('*', requireAuth);

const fail = (c, error, status = 400) => c.json({ ok: false, error }, status);

const SUBMENU_ID_RE = /^[a-z0-9_-]{1,32}$/;

function sanitizeButtons(input, validSubIds, { maxRows = 10 } = {}) {
  const rows = [];
  if (!Array.isArray(input)) return rows;
  for (const row of input.slice(0, maxRows)) {
    if (!Array.isArray(row)) continue;
    const btns = [];
    for (const b of row.slice(0, 8)) {
      const text = String((b && b.text) || '').trim().slice(0, 64);
      if (!text) continue;
      const type = ['url', 'callback', 'submenu', 'text'].includes(b.type) ? b.type : 'callback';
      const value = String((b && b.value) || '').trim();
      if (type === 'url') {
        if (/^https?:\/\//i.test(value)) btns.push({ text, type, value: value.slice(0, 512) });
      } else if (type === 'callback') {
        if (value.length >= 1 && value.length <= 64) btns.push({ text, type, value });
      } else if (type === 'submenu') {
        if (SUBMENU_ID_RE.test(value) && validSubIds.has(value)) btns.push({ text, type, value });
      } else if (type === 'text') {
        if (value.length >= 1 && value.length <= 200) btns.push({ text, type, value });
      }
    }
    if (btns.length) rows.push(btns);
  }
  return rows;
}

function sanitizeMenu(input = {}) {
  const clean = (s, max) => String(s ?? '').trim().slice(0, max);

  const rawSubs = (input && typeof input.submenus === 'object' && input.submenus) || {};
  const validSubIds = new Set(
    Object.keys(rawSubs).filter((id) => SUBMENU_ID_RE.test(id))
  );

  const welcome = {
    fa: clean(input?.welcome?.fa, 3500) || DEFAULT_MENU.welcome.fa,
    en: clean(input?.welcome?.en, 3500) || DEFAULT_MENU.welcome.en,
  };
  const help = {
    fa: clean(input?.help?.fa, 3500) || DEFAULT_MENU.help.fa,
    en: clean(input?.help?.en, 3500) || DEFAULT_MENU.help.en,
  };

  const inlineButtons = sanitizeButtons(input?.inlineButtons, validSubIds, { maxRows: 10 });
  const submenus = {};
  for (const id of validSubIds) {
    const sm = rawSubs[id] || {};
    const buttons = sanitizeButtons(sm.buttons, validSubIds, { maxRows: 10 });
    submenus[id] = {
      title: clean(sm.title, 64),
      text: clean(sm.text, 3500),
      buttons: buttons.length ? buttons : [[{ text: '…', type: 'text', value: '…' }]],
    };
  }

  if (!inlineButtons.length) inlineButtons.push(...JSON.parse(JSON.stringify(DEFAULT_MENU.inlineButtons)));
  if (!Object.keys(submenus).length) submenus.shop = JSON.parse(JSON.stringify(DEFAULT_MENU.submenus.shop));

  return { welcome, help, inlineButtons, submenus };
}

r.get('/', async (c) =>
  c.json({ ok: true, data: { menu: await getMenu(c.env), defaults: DEFAULT_MENU } })
);

r.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const menu = sanitizeMenu(body);
  await saveMenu(c.env, menu);
  return c.json({ ok: true, data: { menu } });
});

r.post('/preview', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const chatId = Number(body.chatId);
  if (!Number.isInteger(chatId) || chatId <= 0) return fail(c, 'invalid_chat_id');

  const token = await resolveToken(c.env);
  if (!token) return fail(c, 'token_missing');

  const [menu, settings] = await Promise.all([getMenu(c.env), getSettings(c.env)]);
  try {
    await sendStart(token, chatId, { id: chatId, firstName: 'Admin' }, menu, 'fa', settings);
    return c.json({ ok: true, data: { sent: true } });
  } catch (e) {
    return fail(c, 'telegram_error');
  }
});

export default r;
