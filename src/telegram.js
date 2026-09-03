
import {
  getMenu, getSettings, getUser, putUser, bumpStats, pushRecentUser,
  getPoll, putPoll, pollTotals, getPost, putPost,
  getTicket, ticketAppendUser,
} from './kv.js';

const BOT_T = {
  fa: {
    chooseLang: '🌍 زبان خود را انتخاب کنید:',
    unknown: '🤔 متوجه نشدم. برای دیدن راهنما /help را بزنید.',
    langSet: '✅ زبان به فارسی تغییر کرد.',
    yourId: '🆔 آیدی عددی شما:',
    pong: '🏓 پونگ! ربات فعال است.',
    singleLang: '🌍 این ربات فقط به فارسی پاسخ می‌دهد.',
    lock: '🔒 برای استفاده از ربات، ابتدا در کانال ما عضو شوید:',
    lockOk: '✅ عضویت تایید شد! ربات برای شما فعال شد. /start را بزنید.',
    lockNo: '❌ هنوز عضو کانال نشده‌اید. ابتدا عضو شوید و دوباره بزنید.',
    lockBtn: '📢 عضویت در کانال',
    lockCheck: '✅ عضو شدم',
    supportIntro: '🛡 حالا در حالت گفتگو با پشتیبانی هستید.\nپیام خود را بنویسید؛ کارشناسان ما در اولین فرصت پاسخ می‌دهند.\n\nبرای پایان /end را بزنید.',
    supportSent: '✅ پیام شما به پشتیبانی ارسال شد. پاسخ را همین‌جا دریافت می‌کنید.',
    supportClosed: '✅ گفتگوی پشتیبانی بسته شد. مجدداً نیاز بود /support را بفرستید.',
    supportReply: '💬 پاسخ پشتیبانی:',
    voteDone: '✅ رأی شما ثبت شد',
    voteMoved: '✅ رأی شما تغییر کرد',
    voteSame: ' شما همین گزینه را انتخاب کرده‌اید',
    voteRefresh: '🔄 نتایج بروزرسانی شد',
    voteGone: '⌛ این نظرسنجی منقضی شده است',
    reactDone: '👍 ثبت شد',
    reactOff: 'برداشته شد',
    back: '⬅️ بازگشت',
    refresh: '🔄 بروزرسانی نتایج',
  },
  en: {
    chooseLang: '🌍 Please choose your language:',
    unknown: "🤔 I didn't understand. Send /help for usage.",
    langSet: '✅ Language changed to English.',
    yourId: '🆔 Your numeric ID:',
    pong: '🏓 Pong! The bot is alive.',
    singleLang: '🌍 This bot only responds in English.',
    lock: '🔒 To use this bot, please join our channel first:',
    lockOk: '✅ Membership confirmed! The bot is now active for you. Send /start.',
    lockNo: "❌ You haven't joined the channel yet. Join first, then tap again.",
    lockBtn: '📢 Join the channel',
    lockCheck: '✅ I joined',
    supportIntro: '🛡 You are now chatting with the support team.\nSend your message; our team will reply here as soon as possible.\n\nSend /end to finish.',
    supportSent: '✅ Your message was sent to support. The reply will arrive here.',
    supportClosed: '✅ Support chat closed. Send /support whenever you need us again.',
    supportReply: '💬 Support reply:',
    voteDone: '✅ Your vote was recorded',
    voteMoved: '✅ Your vote was changed',
    voteSame: 'You already picked this option',
    voteRefresh: '🔄 Results updated',
    voteGone: '⌛ This poll has expired',
    reactDone: '👍 Recorded',
    reactOff: 'Removed',
    back: '⬅️ Back',
    refresh: '🔄 Refresh results',
  },
};

export async function resolveToken(env) {
  const s = await getSettings(env);
  return s.botToken || env.BOT_TOKEN || null;
}

export async function tgApi(token, method, payload = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json().catch(() => ({
      ok: false, error_code: res.status, description: 'Invalid JSON response',
    }));
  } catch (e) {
    return { ok: false, error_code: 0, description: String((e && e.message) || e) };
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function withTimeout(promise, ms, fallback = null) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

export function effectiveLang(user, settings) {
  const mode = (settings && settings.botLangMode) || 'both';
  if (mode === 'fa') return 'fa';
  if (mode === 'en') return 'en';
  const l = (user && user.lang) || (settings && settings.defaultLang) || 'fa';
  return BOT_T[l] ? l : 'fa';
}

function withSupport(rows, settings, lang) {
  const sb = settings && settings.supportButton;
  if (!sb || !sb.enabled) return rows || [];
  const has = (rows || []).some((r) => (r || []).some((b) => b && b.type === 'callback' && b.value === 'support:open'));
  if (has) return rows || [];
  const text = String((lang === 'en' ? sb.en : sb.fa) || sb.fa || '🛡 پشتیبانی').slice(0, 64);
  return [...(rows || []), [{ text, type: 'callback', value: 'support:open' }]];
}

export function renderTpl(text = '', user = {}) {
  return String(text)
    .replace(/\{name\}/g, user.firstName || '')
    .replace(/\{username\}/g, user.username ? `@${user.username}` : '')
    .replace(/\{id\}/g, String(user.id || ''));
}

export function pageMarkup(rows, { withBack = false, T = BOT_T.fa } = {}) {
  const kb = rows.map((row) =>
    row.map((b) => {
      if (b.type === 'url') return { text: b.text, url: b.value };
      if (b.type === 'text') return { text: b.text, callback_data: `txt:${b._src || 'root'}:${b._r}:${b._c}` };
      if (b.type === 'submenu') return { text: b.text, callback_data: `sub:${b.value}` };
      return { text: b.text, callback_data: String(b.value || 'noop').slice(0, 64) };
    })
  );
  if (withBack) kb.push([{ text: T.back, callback_data: 'sub:root' }]);
  return { inline_keyboard: kb };
}

function tagButtons(rows, src) {
  return rows.map((row, r) => row.map((b, c) => ({ ...b, _src: src, _r: r, _c: c })));
}

export function inlineMarkup(menu, settings, lang) {
  const rows = withSupport(menu.inlineButtons, settings, lang || 'fa');
  return pageMarkup(tagButtons(rows, 'root'), { withBack: false });
}

export function sendToUser(token, chatId, text, extra = {}) {
  return tgApi(token, 'sendMessage', { chat_id: chatId, text, ...extra });
}

export function renderPollText(poll) {
  const total = pollTotals(poll);
  const lines = poll.opts.map((o) => {
    const n = o.n || 0;
    const pct = total ? Math.round((n * 100) / total) : 0;
    const bars = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    return `${o.label}\n${bars} ${pct}% (${n})`;
  });
  return `📊 ${poll.q}\n\n${lines.join('\n\n')}\n\n🗳 ${total}`;
}

export function pollKeyboard(poll, T = BOT_T.fa) {
  const kb = poll.opts.map((o, i) => [{ text: o.label, callback_data: `poll:${poll.id}:${i}` }]);
  kb.push([{ text: T.refresh, callback_data: `poll:${poll.id}:r` }]);
  return { inline_keyboard: kb };
}

export function sendPollToChat(token, chatId, poll, T = BOT_T.fa) {
  return tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text: renderPollText(poll),
    reply_markup: pollKeyboard(poll, T),
    disable_web_page_preview: true,
  });
}

export function reactMarkup(post) {
  return {
    inline_keyboard: [[
      { text: `👍 ${post.likes || 0}`, callback_data: `react:${post.id}:l` },
      { text: `👎 ${post.dislikes || 0}`, callback_data: `react:${post.id}:d` },
    ]],
  };
}

export function sendPostToChat(token, chatId, post, parseMode) {
  return tgApi(token, 'sendPhoto', {
    chat_id: chatId,
    photo: post.photo,
    caption: post.caption || undefined,
    parse_mode: parseMode || undefined,
    reply_markup: reactMarkup(post),
  });
}

export async function touchUser(env, from) {
  const now = Date.now();
  const existing = await getUser(env, from.id);
  if (!existing) {
    const user = {
      id: from.id,
      firstName: from.first_name || '',
      username: from.username || '',
      lang: '',
      joinedAt: now,
      lastSeen: now,
      banned: false,
      bannedAt: 0,
      banReason: '',
      blockedBot: false,
      supportOpen: false,
      chanOk: false,
      chanCheckedAt: 0,
    };
    await putUser(env, user);
    await bumpStats(env, { users: 1 });
    await pushRecentUser(env, user.id);
    return { user, isNew: true };
  }
  const firstName = from.first_name || existing.firstName;
  const username = from.username || existing.username;
  const changed = firstName !== existing.firstName || username !== existing.username;
  if (changed || now - (existing.lastSeen || 0) > 5 * 60 * 1000) {
    existing.firstName = firstName;
    existing.username = username;
    existing.lastSeen = now;
    await putUser(env, existing);
  }
  return { user: existing, isNew: false };
}

export function channelJoinUrl(rc) {
  if (rc.url && /^https?:\/\//i.test(rc.url)) return rc.url;
  const id = String(rc.chatId || '');
  if (id.startsWith('@')) return `https://t.me/${id.slice(1)}`;
  if (id.startsWith('-100')) return `https://t.me/c/${id.slice(4)}`;
  return id ? `https://t.me/${id}` : '';
}

export async function channelGate(env, token, user, settings) {
  const rc = settings.requiredChannel;
  if (!rc || !rc.enabled || !rc.chatId) return { ok: true };

  const now = Date.now();
  if (user.chanOk && user.chanCheckedAt && now - user.chanCheckedAt < 15 * 60 * 1000) {
    return { ok: true };
  }
  const res = await withTimeout(
    tgApi(token, 'getChatMember', { chat_id: rc.chatId, user_id: Number(user.id) }),
    6000, null
  );
  if (!res || !res.ok) {
    console.warn('[channel-lock] membership check failed:', res && res.description);
    return { ok: true };
  }
  const ok = ['member', 'administrator', 'creator'].includes(res.result && res.result.status);
  user.chanOk = ok;
  user.chanCheckedAt = now;
  await putUser(env, user);
  return ok ? { ok: true } : { ok: false, url: channelJoinUrl(rc) };
}

function lockKeyboard(url, T) {
  const kb = [];
  if (url) kb.push([{ text: T.lockBtn, url }]);
  kb.push([{ text: T.lockCheck, callback_data: 'chan:check' }]);
  return { inline_keyboard: kb };
}

async function sendLock(token, chatId, url, lang) {
  const T = BOT_T[lang] || BOT_T.fa;
  return sendToUser(token, chatId, T.lock, { reply_markup: lockKeyboard(url, T) });
}

export async function handleUpdate(env, update) {
  try {
    if (update.message) return await onMessage(env, update.message);
    if (update.callback_query) return await onCallback(env, update.callback_query);
  } catch (e) {
    console.error('[webhook] update error:', e);
  }
}

async function onMessage(env, msg) {
  const from = msg.from;
  if (!from || from.is_bot) return;

  const token = await resolveToken(env);
  if (!token) return;

  const settings = await getSettings(env);
  const { user } = await touchUser(env, from);
  if (user.banned) return;

  const text = String(msg.text || '').trim();
  const chatId = msg.chat.id;

  const gate = await channelGate(env, token, user, settings);
  if (!gate.ok) return await sendLock(token, chatId, gate.url, user.lang || settings.defaultLang);

  bumpStats(env, { messages: 1 });
  if (!text) return;

  const lang = effectiveLang(user, settings);
  const T = BOT_T[lang];
  const menu = await getMenu(env);

  const isCmd = text.startsWith('/');
  if (user.supportOpen && !isCmd) {
    await ticketAppendUser(env, user, text);
    return sendToUser(token, chatId, T.supportSent);
  }

  if (isCmd) {
    const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();
    switch (cmd) {
      case '/start': {
        user.supportOpen = false;
        await putUser(env, user);
        return await sendStart(token, chatId, user, menu, lang, settings);
      }
      case '/help':
        return await sendToUser(token, chatId, renderTpl(menu.help[lang] || menu.help.fa, user), {
          disable_web_page_preview: true,
        });
      case '/lang':
        if ((settings.botLangMode || 'both') !== 'both') return sendToUser(token, chatId, T.singleLang);
        return await sendToUser(token, chatId, T.chooseLang, { reply_markup: langKeyboard() });
      case '/id':
        return await sendToUser(token, chatId, `${T.yourId} <code>${user.id}</code>`, {
          parse_mode: 'HTML',
        });
      case '/ping':
        return await sendToUser(token, chatId, T.pong);
      case '/support': {
        user.supportOpen = true;
        await putUser(env, user);
        await getTicket(env, user.id);
        return sendToUser(token, chatId, T.supportIntro);
      }
      case '/end': {
        if (user.supportOpen) {
          user.supportOpen = false;
          await putUser(env, user);
        }
        return sendToUser(token, chatId, T.supportClosed);
      }
      default:
        return await sendToUser(token, chatId, T.unknown);
    }
  }

  return await sendToUser(token, chatId, T.unknown);
}

export async function sendStart(token, chatId, user, menu, lang, settings) {
  const welcome = renderTpl(menu.welcome[lang] || menu.welcome.en || menu.welcome.fa, user);
  await sendToUser(token, chatId, welcome, {
    reply_markup: inlineMarkup(menu, settings, lang),
    disable_web_page_preview: true,
  });
}

function langKeyboard() {
  return {
    inline_keyboard: [[
      { text: 'فارسی 🇮🇷', callback_data: 'setlang:fa' },
      { text: 'English 🇬🇧', callback_data: 'setlang:en' },
    ]],
  };
}

async function showPage(token, chatId, messageId, menu, pageId, lang, settings) {
  const T = BOT_T[lang] || BOT_T.fa;
  let text, rows, src, withBack = false;
  if (pageId === 'root') {
    text = renderTpl(menu.welcome[lang] || menu.welcome.fa, {});
    rows = withSupport(menu.inlineButtons, settings, lang); src = 'root';
  } else {
    const sm = (menu.submenus || {})[pageId];
    if (!sm) { pageId = 'root'; text = renderTpl(menu.welcome[lang] || menu.welcome.fa, {}); rows = withSupport(menu.inlineButtons, settings, lang); src = 'root'; }
    else { text = `${sm.title ? sm.title + '\n\n' : ''}${sm.text}`; rows = withSupport(sm.buttons, settings, lang); src = pageId; withBack = true; }
  }
  return tgApi(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: pageMarkup(tagButtons(rows || [], src), { withBack, T }),
    disable_web_page_preview: true,
  });
}

async function onCallback(env, cb) {
  const from = cb.from;
  const token = await resolveToken(env);
  if (!token) return;

  const user = await getUser(env, from.id);
  if (!user || user.banned) return;
  user.lastSeen = Date.now();

  const data = String(cb.data || '');
  const answer = (text, alert = false) =>
    tgApi(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: text || undefined, show_alert: alert });
  const chatId = cb.message && cb.message.chat ? cb.message.chat.id : null;
  const messageId = cb.message ? cb.message.message_id : null;
  const edit = (text, reply_markup) =>
    chatId && messageId && tgApi(token, 'editMessageText', {
      chat_id: chatId, message_id: messageId, text, reply_markup, disable_web_page_preview: true,
    });

  if (data === 'chan:check') {
    const settings = await getSettings(env);
    const gate = await channelGate(env, token, user, settings);
    const lang = user.lang || settings.defaultLang;
    const T = BOT_T[lang] || BOT_T.fa;
    if (gate.ok) {
      user.supportOpen = user.supportOpen;
      await tgApi(token, 'editMessageText', {
        chat_id: chatId, message_id: messageId, text: T.lockOk,
      }).catch(() => {});
      return answer(T.lockOk, true);
    }
    return answer(T.lockNo, true);
  }

  const settings = await getSettings(env);
  const gate = await channelGate(env, token, user, settings);
  if (!gate.ok) {
    await sendLock(token, chatId, gate.url, user.lang || settings.defaultLang);
    return answer();
  }

  const lang = BOT_T[user.lang || settings.defaultLang] ? (user.lang || settings.defaultLang) : 'fa';
  const T = BOT_T[lang];
  const menu = await getMenu(env);

  if (data.startsWith('setlang:') && (settings.botLangMode || 'both') !== 'both') {
    return answer(BOT_T[effectiveLang(user, settings)].singleLang, true);
  }
  if (data === 'setlang:menu') {
    await sendToUser(token, chatId, T.chooseLang, { reply_markup: langKeyboard() });
    return answer();
  }
  if (data === 'setlang:fa' || data === 'setlang:en') {
    const l = data.slice(8);
    user.lang = l;
    await putUser(env, user);
    const TT = BOT_T[l];
    await tgApi(token, 'editMessageText', {
      chat_id: chatId, message_id: messageId,
      text: `${TT.langSet}\n\n${renderTpl(menu.welcome[l], user)}`,
      reply_markup: inlineMarkup(menu, settings, l),
      disable_web_page_preview: true,
    });
    return answer(TT.langSet);
  }

  if (data.startsWith('sub:')) {
    const pageId = data.slice(4);
    await showPage(token, chatId, messageId, menu, pageId === 'root' ? 'root' : pageId, lang, settings);
    return answer();
  }

  if (data.startsWith('txt:')) {
    const [, src, r, c] = data.split(':');
    const rows = src === 'root' ? menu.inlineButtons : ((menu.submenus || {})[src] || {}).buttons || [];
    const btn = (rows[+r] || [])[+c];
    const popup = btn && btn.type === 'text' ? String(btn.value).slice(0, 200) : '…';
    return answer(popup, true);
  }

  if (data === 'support:open') {
    user.supportOpen = true;
    await putUser(env, user);
    await sendToUser(token, chatId, T.supportIntro);
    return answer();
  }

  if (data.startsWith('poll:')) {
    const [, id, act] = data.split(':');
    const poll = await getPoll(env, id);
    if (!poll) return answer(T.voteGone, true);
    if (act === 'r') {
      await edit(renderPollText(poll), pollKeyboard(poll, T));
      return answer(T.voteRefresh);
    }
    const i = Number(act);
    if (!(Number.isInteger(i) && i >= 0 && i < poll.opts.length)) return answer();
    const prev = poll.voters ? poll.voters[user.id] : undefined;
    if (prev === i) return answer(T.voteSame);
    if (prev !== undefined && poll.opts[prev]) poll.opts[prev].n = Math.max(0, (poll.opts[prev].n || 0) - 1);
    poll.opts[i].n = (poll.opts[i].n || 0) + 1;
    poll.voters = poll.voters || {};
    poll.voters[user.id] = i;
    if (Object.keys(poll.voters).length > 4000) poll.voters = {};
    await putPoll(env, poll);
    await edit(renderPollText(poll), pollKeyboard(poll, T));
    return answer(prev === undefined ? T.voteDone : T.voteMoved);
  }

  if (data.startsWith('react:')) {
    const [, id, act] = data.split(':');
    const post = await getPost(env, id);
    if (!post) return answer(T.voteGone, true);
    post.voters = post.voters || {};
    const prev = post.voters[user.id];
    if (act === 'l') {
      if (prev === 'l') { post.likes = Math.max(0, (post.likes || 0) - 1); delete post.voters[user.id]; }
      else {
        post.likes = (post.likes || 0) + 1;
        if (prev === 'd') post.dislikes = Math.max(0, (post.dislikes || 0) - 1);
        post.voters[user.id] = 'l';
      }
    } else if (act === 'd') {
      if (prev === 'd') { post.dislikes = Math.max(0, (post.dislikes || 0) - 1); delete post.voters[user.id]; }
      else {
        post.dislikes = (post.dislikes || 0) + 1;
        if (prev === 'l') post.likes = Math.max(0, (post.likes || 0) - 1);
        post.voters[user.id] = 'd';
      }
    }
    if (Object.keys(post.voters).length > 4000) post.voters = {};
    await putPost(env, post);
    if (chatId && messageId) {
      await tgApi(token, 'editMessageReplyMarkup', {
        chat_id: chatId, message_id: messageId, reply_markup: reactMarkup(post),
      });
    }
    return answer(T.reactDone);
  }

  return answer();
}
