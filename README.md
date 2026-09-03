# 🤖 BotPanel — پنل مدیریت ربات تلگرام

پنل مدیریت وب **دو زبانه (فارسی/انگلیسی)**، آماده پروداکشن، برای ربات تلگرام — کاملاً میزبانی‌شده روی **Cloudflare Workers** با پایگاه‌داده **Cloudflare KV** (بدون نیاز به سرور، بدون هزینه در پلن رایگان برای شروع).

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020) ![KV](https://img.shields.io/badge/Storage-KV-blue) ![Hono](https://img.shields.io/badge/API-Hono-ff6a33) ![Tailwind](https://img.shields.io/badge/UI-Tailwind%20CSS-38bdf8)

---

## ✨ امکانات

| بخش | توضیح |
|---|---|
| 🔐 **احراز هویت امن** | ورود با رمز عبور ذخیره‌شده در Wrangler Secrets، مقایسه timing-safe، نشست با توکن ۶۴ کاراکتری (فقط هش SHA-256 آن در KV ذخیره می‌شود)، محدودیت نرخ ورود (۵ تلاش / ۱۰ دقیقه به‌ازای IP) |
| 📊 **داشبورد و وضعیت لحظه‌ای** | آمار کلی (کاربران، مسدودها، پیام‌ها، ارسال‌های همگانی)، نشانگر زنده ورکر با تأخیر و مرکز داده (`colo`) + پینگ خودکار هر ۳۰ ثانیه، وضعیت وب‌هوک تلگرام (آپدیت‌های در انتظار و آخرین خطا) |
| 👥 **مدیریت کاربران** | لیست با صفحه‌بندی cursor بومی KV، جستجو (نام/یوزرنیم/آیدی)، مسدودسازی با دلیل، آزادسازی، ارسال پیام مستقیم، مشاهده جزئیات کامل |
| 📢 **موتور ارسال همگانی** | متن + فرمت (HTML / MarkdownV2) + دکمه‌های URL، هدف‌گیری (همه / فعال ۷ روز / فعال ۳۰ روز)، معماری دسته‌ای (batch) با **Rate-Limit** قابل تنظیم، نوار پیشرفت زنده، توقف موقت/ادامه/توقف قطعی، تشخیص خودکار کاربرانی که ربات را بلاک کرده‌اند |
| ⌨️ **سازنده منو و دکمه‌ها** | ویرایش پیام خوش‌آمد/راهنما (فا/EN) با متغیرهای `{name}` `{username}` `{id}`، کیبورد اصلی، دکمه‌های شیشه‌ای (URL/Callback)، **شبیه‌ساز زنده ربات** و ارسال پیش‌نمایش واقعی به چت |
| ⚙️ **مدیریت تنظیمات** | توکن ربات (ماسک‌شده)، آیدی ادمین‌ها، زبان پیش‌فرض، تنظیم/حذف وب‌هوک با یک کلیک، تیونینگ ارسال همگانی، سوئیچ زبان پنل (RTL/LTR) و حالت تاریک/روشن |

ربات پایه هم دستورات `/start`، `/help`، `/lang`، `/id` و `/ping` را پیاده‌سازی کرده و ساختار منو کاملاً از پنل قابل کنترل است.

---

## 🏗️ معماری

```
                        ┌──────────────────────────────────┐
                        │        Cloudflare Edge           │
   Telegram ── webhook ─►  Worker (Hono, ES Modules)       │
   Admin    ── HTTPS ───►   ├─ POST /telegram/webhook      │
                           │   └─ هدر مخفی secret_token   │
                           │   └─ ctx.waitUntil(...)       │
                           │  ├─ /api/*  (پنل، Bearer JWT- │
                           │  │            like session)   │
                           │  └─ /*  → SPA (Assets)        │
                           │            │                  │
                           │        BOT_KV (KV)             │
                           │  settings, menu, stats,        │
                           │  user:{id}, session:{hash},    │
                           │  broadcast:{id}                │
                           └──────────┬──────────────────────┘
                                      │ Bot API (fetch)
                                      ▼
                               api.telegram.org
```

**چرا ارسال همگان دسته‌ای (tick) است؟** هر درخواست Worker در پلن رایگان به ~۵۰ subrequest محدود است. پنل هر بار یک «دسته» (پیش‌فرض ۲۵ پیام با فاصله ۴۰ms ≈ ۲۵ پیام/ثانیه، کمتر از سقف ~۳۰ تلگرام) می‌فرستد و جاب در KV ذخیره می‌شود؛ نتیجه: بدون محدودیت تعداد کاربر، قابل ازسرگیری و با پیشرفت زنده.

### ساختار پروژه

```
telegram-admin-panel/
├── wrangler.toml          # پیکربندی Worker + بایندینگ KV و Assets
├── package.json
├── .dev.vars              # محرمانه‌های توسعه لوکال (commit نمی‌شود)
├── .dev.vars.example
├── src/
│   ├── index.js           # ورودی: مسیریابی وب‌هوک / API / SPA
│   ├── kv.js              # لایه دسترسی به داده روی KV (طرح کلیدها)
│   ├── auth.js            # نشست‌ها، timing-safe compare، Rate-limit ورود
│   ├── telegram.js        # کلاینت Bot API + منطق وب‌هوک ربات
│   └── routes/
│       ├── auth.routes.js       # POST /api/auth/login|logout, GET session
│       ├── dashboard.routes.js  # GET /api/dashboard/stats
│       ├── users.routes.js      # GET/POST /api/users/...
│       ├── broadcast.routes.js  # POST /api/broadcast + /tick + کنترل
│       ├── menu.routes.js       # GET/PUT /api/menu + /preview
│       └── settings.routes.js   # GET/PUT /api/settings + /webhook
├── public/
│   └── index.html         # SPA (Tailwind CDN + Lucide + Vazirmatn)
└── scripts/
    └── smoke.mjs          # تست دود: npm run smoke (بدون نیاز به wrangler)
```

---

## 🚀 راه‌اندازی سریع (لوکال)

پیش‌نیاز: Node.js ≥ 18

```bash
npm install

# محرمانه‌های لوکال را آماده کنید (رمز پنل = change-me-dev)
cp .dev.vars.example .dev.vars

npm run dev            # → http://localhost:8787
```

تست‌ها:

```bash
npm run smoke          # ۲۹ تست API/وب‌هوک با KV درون‌حافظه‌ای
```

---

## ☁️ استقرار پروداکشن

```bash
npx wrangler login

# ۱) ساخت KV namespace و جایگزینی id در wrangler.toml
npx wrangler kv namespace create BOT_KV

# ۲) تنظیم محرمانه‌ها (هرگز داخل wrangler.toml ننویسید!)
npx wrangler secret put ADMIN_PASSWORD    # رمز ورود پنل
npx wrangler secret put WEBHOOK_SECRET    # رشته تصادفی طولانی، مثل: openssl rand -hex 32
npx wrangler secret put BOT_TOKEN         # (اختیاری) توکن @BotFather — از پنل هم قابل تنظیم است

# ۳) دیپلوی
npm run deploy
```

### اتصال وب‌هوک تلگرام

بعد از دیپلوی، در پنل وارد شوید → **تنظیمات → مدیریت وب‌هوک → تنظیم وب‌هوک**.
دکمه، آدرس `https://<worker>.workers.dev/telegram/webhook` را با `secret_token` (همان `WEBHOOK_SECRET`) روی تلگرام ست می‌کند و از آن پس هر آپدیت فقط با هدر مخفی معتبر پردازش می‌شود.

معادل دستی:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d 'url=https://<worker>.workers.dev/telegram/webhook' \
  -d 'secret_token=<WEBHOOK_SECRET>' \
  -d 'allowed_updates=["message","callback_query"]'
```

> 💡 در ربات `/id` را بفرستید تا آیدی عددی خود را بگیرید و در «آیدی ادمین‌ها» ثبت کنید.

---

## 🔑 متغیرهای محیطی

| نام | نوع | توضیح |
|---|---|---|
| `ADMIN_PASSWORD` | Secret | رمز ورود پنل (اجباری — بدون آن login با خطای `server_not_configured` رد می‌شود) |
| `WEBHOOK_SECRET` | Secret | هدر `X-Telegram-Bot-Api-Secret-Token` برای احراز هویت وب‌هوک |
| `BOT_TOKEN` | Secret | توکن ربات (اختیاری؛ ترجیحاً از پنل در KV ست شود) |
| `APP_VERSION` | Var | نمایش در داشبورد |
| `BOT_KV` | KV binding | پایگاه‌داده |
| `ASSETS` | Assets binding | سرو فایل‌های SPA |

## 🗄️ طرح کلیدهای KV

| کلید | مقدار | توضیح |
|---|---|---|
| `settings` | JSON | توکن، ادمین‌ها، زبان پیش‌فرض، تیونینگ broadcast |
| `menu` | JSON | پیام‌ها و کیبوردهای ربات |
| `stats` | JSON | شمارنده‌ها (تقریبی — KV افزایش اتمیک ندارد) |
| `recent_users` | JSON | ۱۰ کاربر جدید |
| `user:{id}` | JSON + metadata | رکورد کاربر؛ metadata فشرده مبنای لیست/جستجو/هدف‌گیری |
| `session:{sha256}` | JSON + TTL ۷روز | نشست ادمین |
| `rl:{ip}` | JSON + TTL ۱۰دقیقه | شمارنده ورود ناموفق |
| `broadcast:{id}` | JSON | جاب ارسال همگانی + آرایه اهداف + cursor |
| `broadcast:index` | JSON | ۲۰ جاب اخیر |

## 🔌 API

همه پاسخ‌ها `{ok:true,data}` یا `{ok:false,error}` هستند. احراز هویت با هدر `Authorization: Bearer <token>`.

| متد | مسیر | توضیح |
|---|---|---|
| POST | `/api/auth/login` | ورود `{password}` → `{token, expiresAt}` |
| GET | `/api/auth/session` | اعتبارسنجی نشست |
| POST | `/api/auth/logout` | خروج |
| GET | `/api/health` | عمومی — سلامت ورکر + colo |
| GET | `/api/dashboard/stats` | آمار + کاربران اخیر + وضعیت وب‌هوک |
| GET | `/api/users?cursor&limit&q` | لیست/جستجوی کاربران |
| GET | `/api/users/:id` | رکورد کامل |
| POST | `/api/users/:id/ban` | مسدودسازی `{reason?}` |
| POST | `/api/users/:id/unban` | آزادسازی |
| POST | `/api/users/:id/message` | پیام مستقیم `{text, parseMode?}` |
| POST | `/api/broadcast` | ساخت جاب `{text, parseMode?, buttons?, target}` |
| POST | `/api/broadcast/:id/tick` | ارسال دسته بعدی (Rate-limited) |
| POST | `/api/broadcast/:id/pause\|resume\|stop` | کنترل جاب |
| GET | `/api/broadcast(/:id)` | وضعیت/تاریخچه |
| GET/PUT | `/api/menu` | خواندن/ذخیره منو |
| POST | `/api/menu/preview` | ارسال پیش‌نمایش `{chatId}` |
| GET/PUT | `/api/settings` | تنظیمات (توکن همیشه ماسک برمی‌گردد) |
| POST | `/api/settings/webhook` | `{action:'set'\|'delete'}` |
| POST | `/telegram/webhook` | وب‌هوک تلگرام (هدر مخفی الزامی) |

---

## 🛡️ چک‌لیست امنیتی پیاده‌سازی‌شده

- ✅ رمز و رازها فقط در **Wrangler Secrets** (در کد یا KV خام never)
- ✅ مقایسه رمز **timing-safe** (هش + XOR)؛ ورود با **Rate-limit** بر اساس IP
- ✅ در KV فقط **هش نشست** ذخیره می‌شود؛ TTL خودکار
- ✅ وب‌هوک فقط با هدر `X-Telegram-Bot-Api-Secret-Token` معتبر پردازش می‌شود؛ پردازش در `waitUntil` و پاسخ فوری ۲۰۰ به تلگرام
- ✅ توکن ربات در پاسخ‌های API **ماسک** می‌شود؛ اعتبارسنجی کامل ورودی‌ها (URL دکمه‌ها، طول متن‌ها، سقف ردیف/دکمه)
- ✅ ربات پیام کاربران مسدود را نادیده می‌گیرد

## ⚠️ نکات پروداکشن و مقیاس‌پذیری

1. **KV eventually consistent است** — شمارنده‌های آماری «تقریبی»اند (عملیات افزایش اتمیک ندارد). برای آمار دقیق یا داده رابطه‌ای به **D1** مهاجرت کنید.
2. **Subrequest limit** — هر tick حداکثر ۵۰ ارسال (پیش‌فرض ۲۵). با پلن پرداختی می‌توانید `batchSize` را بالا ببرید.
3. **ارسال همگانی خیلی بزرگ** (>ده‌ها هزار کاربر) — برای مقیاس واقعی، موتور tick را به **Cloudflare Queues** یا **Durable Objects** منتقل کنید تا بدون باز بودن پنل ادامه یابد. ساختار job/cursor همین الان با آن‌ها سازگار است.
4. **رقابت هم‌زمانی** — برای جلوگیری از دوبل‌ارسال، tick با وضعیت `ticking` قفل می‌شود (قفل سبک؛ برای تضمین کامل از Durable Object استفاده کنید).
5. لاگ زنده: `npm run tail`

## 🎨 شخصی‌سازی ربات

- متن‌های ثابت ربات (پاسخ دستور ناشناخته، انتخاب زبان و…): `src/telegram.js` → `BOT_T`
- منطق دستورات جدید: تابع `onMessage` در همان فایل (سوئیچ دستورات)
- دکمه‌های callback اختصاصی: انتهای `onCallback`
- ظاهر پنل: `public/index.html` (Tailwind) — رنگ برند در `tailwind.config.colors.brand`

---

ساخته‌شده با ❤️ روی [Cloudflare Workers](https://workers.cloudflare.com/) + [Hono](https://hono.dev/) + [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/)
