<div align="center">

# 🤖 BotPanel

**پنل مدیریت ربات تلگرام | Telegram Bot Admin Panel**

دو زبانه (فارسی/انگلیسی) · آماده پروداکشن · کاملاً Serverless
Bilingual (FA/EN) · Production-ready · Fully serverless

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![Cloudflare KV](https://img.shields.io/badge/Storage-KV_Namespace-0051C3?logo=cloudflare&logoColor=white)
![Hono](https://img.shields.io/badge/API-Hono_Framework-ff6a33)
![Tailwind CSS](https://img.shields.io/badge/UI-Tailwind_CSS-38bdf8?logo=tailwindcss&logoColor=white)
![Languages](https://img.shields.io/badge/UI-%D9%81%D8%A7%8D_EN-green)

**فارسی** · [English ↓](#-english)

</div>

---

<div dir="rtl" lang="fa">

## 📖 معرفی

پنل مدیریت وب **دو زبانه (فارسی/انگلیسی)** برای ربات تلگرام که **تماماً** روی زیرساخت Cloudflare اجرا می‌شود — بدون سرور، بدون دیتابیس خارجی و بدون هزینه در پلن رایگان برای شروع:

- **بک‌اند:** Cloudflare Workers (سینتکس ES Modules + فریمورک Hono)
- **پایگاه‌داده:** Cloudflare KV (نشست‌ها، تنظیمات، کاربران، ارسال همگانی)
- **فرانت‌اند:** اپ تک‌صفحه‌ای (SPA) با Tailwind CSS + آیکون‌های Lucide + فونت وزیرمتن
- **تلگرام:** وب‌هوک امن با هدر مخفی `secret_token` و پاسخ فوری ۲۰۰

## ✨ امکانات

| بخش | توضیح |
|---|---|
| 🔐 احراز هویت امن | رمز در Wrangler Secrets، مقایسه timing-safe، نشست ۷روزه (فقط هش SHA-256 در KV)، محدودیت نرخ ورود (۵ تلاش/۱۰ دقیقه/IP) |
| 📊 داشبورد | آمار کلی، **نشانگر وضعیت لحظه‌ای ورکر** (تأخیر + مرکز داده + پینگ هر ۳۰ ثانیه)، وضعیت وب‌هوک تلگرام، کاربران اخیر |
| 👥 مدیریت کاربران | لیست با صفحه‌بندی cursor بومی KV، جستجو، مسدود/آزادسازی با دلیل، ارسال پیام مستقیم، جزئیات کامل |
| 📢 موتور ارسال همگانی | متن + HTML/MarkdownV2 + دکمه‌های URL، هدف‌گیری (همه / فعال ۷ روز / فعال ۳۰ روز)، **Rate-Limit** قابل تنظیم، پیشرفت زنده، توقف موقت/ادامه/قطعی، تشخیص خودکار بلاک‌کنندگان ربات |
| ⌨️ سازنده منو | ویرایش پیام خوش‌آمد/راهنما (فا/EN) با متغیرهای `{name}` `{username}` `{id}`، کیبورد اصلی، دکمه‌های شیشه‌ای (URL/Callback)، **شبیه‌ساز زنده ربات** + ارسال پیش‌نمایش واقعی |
| ⚙️ تنظیمات | توکن ربات (ماسک‌شده)، آیدی ادمین‌ها، زبان پیش‌فرض، تنظیم/حذف وب‌هوک با یک کلیک، تیونینگ ارسال همگانی |
| 🌍 دو زبانه | سوئیچ کامل فا/EN با RTL/LTR، حالت تاریک/روشن، طراحی اول موبایل |

ربات پایه دستورات `/start` · `/help` · `/lang` · `/id` · `/ping` را دارد و کل منوی آن از پنل کنترل می‌شود.

## 🏗️ معماری

```
تلگرام ──وب‌هوک──►  Cloudflare Worker (Hono)
                    ├─ POST /telegram/webhook   (هدر مخفی + waitUntil)
ادمین   ──HTTPS───► ├─ /api/*                  (Bearer session)
                    └─ /*  →  SPA (Assets)
                              │
                        Cloudflare KV
                 settings · menu · stats · user:{id}
                 session:{hash} · broadcast:{id}
                              │
                              ▼ Bot API (fetch)
                        api.telegram.org
```

**چرا ارسال همگانی «دسته‌ای» است؟** هر درخواست Worker به ~۵۰ subrequest محدود است؛ پنل هر بار یک دسته (پیش‌فرض ۲۵ پیام با فاصله ۴۰ms) می‌فرستد و جاب در KV ذخیره می‌شود → بدون سقف تعداد، قابل ازسرگیری، با پیشرفت زنده.

### ساختار پروژه

```
telegram-bot-panel/
├── wrangler.toml        # پیکربندی Worker + بایندینگ KV و Assets
├── .dev.vars.example    # نمونه محرمانه‌های توسعه لوکال
├── src/
│   ├── index.js         # ورودی: وب‌هوک / API / SPA
│   ├── kv.js            # لایه داده روی KV (طرح کلیدها + metadata)
│   ├── auth.js          # نشست‌ها، مقایسه timing-safe، Rate-limit
│   ├── telegram.js      # کلاینت Bot API + منطق ربات
│   └── routes/          # auth · dashboard · users · broadcast · menu · settings
├── public/index.html    # SPA کامل (Tailwind + Lucide + وزیرمتن)
├── scripts/smoke.mjs    # تست دود (۲۹ تست)
├── assets/              # نشان‌های سازنده
└── DEPLOY.fa.md         # 🚀 راهنمای کامل صفر تا صد
```

## 🖥️ راه‌اندازی لوکال

پیش‌نیاز: Node.js ≥ 18

```bash
git clone https://github.com/developerAmira/telegram-bot-panel.git
cd telegram-bot-panel
npm install

cp .dev.vars.example .dev.vars    # رمز لوکال: change-me-dev
npm run dev                       # → http://localhost:8787

npm run smoke                     # اجرای ۲۹ تست خودکار
```

## ☁️ دیپلوی پروداکشن (خلاصه)

```bash
npx wrangler login                                  # ۱) ورود به کلادفلر
npx wrangler kv namespace create BOT_KV             # ۲) ساخت KV → id را در wrangler.toml بگذارید
npx wrangler secret put ADMIN_PASSWORD              # ۳) رمز ورود پنل
npx wrangler secret put WEBHOOK_SECRET              #    راز وب‌هوک (openssl rand -hex 32)
npx wrangler secret put BOT_TOKEN                   #    توکن @BotFather (اختیاری)
npm run deploy                                      # ۴) دیپلوی 🚀
```

سپس در پنل وارد شوید ← **تنظیمات ← «تنظیم وب‌هوک»** ← در تلگرام `/start` بفرستید. تمام!

📌 **راهنمای کامل قدم‌به‌قدم با عیب‌یابی:** [`DEPLOY.fa.md`](DEPLOY.fa.md)

## 🔌 API (خلاصه)

همه پاسخ‌ها `{ok,data}` / `{ok,error}` با احراز هویت `Authorization: Bearer <token>`:

`POST /api/auth/login` · `GET /api/dashboard/stats` · `GET /api/users?cursor&limit&q` · `POST /api/users/:id/ban|unban|message` · `POST /api/broadcast` + `/:id/tick|pause|resume|stop` · `GET/PUT /api/menu` · `POST /api/menu/preview` · `GET/PUT /api/settings` · `POST /api/settings/webhook` · `GET /api/health` · `POST /telegram/webhook`

## 🛡️ امنیت

رمز و رازها فقط در Wrangler Secrets · مقایسه timing-safe + Rate-limit ورود · ذخیره فقط هش نشست در KV · احراز هویت وب‌هوک با هدر مخفی · ماسک شدن توکن ربات در API · اعتبارسنجی کامل ورودی‌ها (URL، طول، سقف ردیف/دکمه) · نادیده‌گرفتن کاربران مسدود

## ⚠️ نکات مقیاس‌پذیری

شمارنده‌های KV «تقریبی»اند (افزایش اتمیک ندارد ← برای آمار دقیق: D1) · برای ارسال همگانی ده‌ها هزارتایی: Cloudflare Queues یا Durable Objects (ساختار job/cursor همین الان سازگار است) · لاگ زنده: `npx wrangler tail`

</div>

---

## 🇬🇧 English

<div dir="ltr" lang="en">

## 📖 About

A **bilingual (Persian/English)**, production-ready admin panel for a Telegram bot, hosted **entirely** on Cloudflare's serverless infrastructure — no servers, no external database, free-tier friendly:

- **Backend:** Cloudflare Workers (ES Modules syntax + Hono framework)
- **Database:** Cloudflare KV (sessions, settings, users, broadcasts)
- **Frontend:** Single-page app with Tailwind CSS + Lucide icons + Vazirmatn font
- **Telegram:** secure webhook via the `secret_token` header, instant 200 responses

## ✨ Features

| Area | Details |
|---|---|
| 🔐 Secure auth | Password lives in Wrangler Secrets, timing-safe comparison, 7-day sessions (only the SHA-256 hash is stored in KV), login rate-limiting (5 tries / 10 min / IP) |
| 📊 Dashboard | Overall stats, **live worker status** (latency + data center + 30s pings), Telegram webhook health, recent users |
| 👥 User management | KV-native cursor pagination, search, ban/unban with reason, direct messages, full details |
| 📢 Broadcast engine | Text + HTML/MarkdownV2 + URL buttons, targeting (all / active 7d / active 30d), tunable **rate limiting**, live progress, pause/resume/stop, auto-detection of users who blocked the bot |
| ⌨️ Menu builder | Edit welcome/help texts (FA/EN) with `{name}` `{username}` `{id}` variables, main keyboard, inline buttons (URL/Callback), **live bot simulator** + real preview sending |
| ⚙️ Settings | Bot token (masked), admin IDs, default language, one-click webhook set/delete, broadcast tuning |
| 🌍 Bilingual | Full FA/EN switch with RTL/LTR, dark/light mode, mobile-first design |

The bundled bot implements `/start` · `/help` · `/lang` · `/id` · `/ping`, and its entire menu is controlled from the panel.

## 🖥️ Local Development

Prerequisite: Node.js ≥ 18

```bash
git clone https://github.com/developerAmira/telegram-bot-panel.git
cd telegram-bot-panel
npm install

cp .dev.vars.example .dev.vars    # local password: change-me-dev
npm run dev                       # → http://localhost:8787

npm run smoke                     # run the 29 automated tests
```

## ☁️ Production Deployment (summary)

```bash
npx wrangler login                                  # 1) sign in to Cloudflare
npx wrangler kv namespace create BOT_KV             # 2) create KV → put id in wrangler.toml
npx wrangler secret put ADMIN_PASSWORD              # 3) panel login password
npx wrangler secret put WEBHOOK_SECRET              #    webhook secret (openssl rand -hex 32)
npx wrangler secret put BOT_TOKEN                   #    @BotFather token (optional)
npm run deploy                                      # 4) deploy 🚀
```

Then sign in to the panel → **Settings → "Set webhook"** → send `/start` to your bot on Telegram. Done!

📌 **Full step-by-step guide (Persian) with troubleshooting:** [`DEPLOY.fa.md`](DEPLOY.fa.md)

## 🔌 API (summary)

All responses are `{ok,data}` / `{ok,error}` authenticated via `Authorization: Bearer <token>`:

`POST /api/auth/login` · `GET /api/dashboard/stats` · `GET /api/users?cursor&limit&q` · `POST /api/users/:id/ban|unban|message` · `POST /api/broadcast` + `/:id/tick|pause|resume|stop` · `GET/PUT /api/menu` · `POST /api/menu/preview` · `GET/PUT /api/settings` · `POST /api/settings/webhook` · `GET /api/health` · `POST /telegram/webhook`

## 🛡️ Security

Secrets only in Wrangler Secrets · timing-safe comparison + login rate-limit · sessions stored hashed in KV · webhook authenticated by secret header · bot token always masked in API responses · full input validation (URLs, lengths, row/button limits) · banned users ignored by the bot

## ⚠️ Scaling Notes

KV counters are approximate (no atomic increments → use D1 for exact stats) · for very large broadcasts (tens of thousands), move the tick engine to Cloudflare Queues or Durable Objects (the job/cursor structure is already compatible) · live logs: `npx wrangler tail`

</div>

---

<div align="center">

## 📮 سازنده | Creator

[![Developed & Published by @developer_as](assets/made-by-developer_as.svg)](https://t.me/developer_as)

[![@x.amirrezaa1](assets/instagram-badge.svg)](https://instagram.com/x.amirrezaa1)

**تلگرام | Telegram:** [@developer_as](https://t.me/developer_as) · **اینستاگرام | Instagram:** [@x.amirrezaa1](https://instagram.com/x.amirrezaa1)

ساخته‌شده با ❤️ روی Cloudflare Workers · Made with ❤️ on Cloudflare Workers

</div>
