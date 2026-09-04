import { Bot, InlineKeyboard } from 'grammy';

const token = process.env.TELEGRAM_BOT_TOKEN;
// A single canonical URL (not the comma-separated WEB_ORIGIN CORS list —
// Telegram needs exactly one URL for the Mini App button).
const webOrigin = process.env.MINI_APP_URL;
// The api service's address *inside* the compose network (e.g. http://api:3001)
// — not API_PUBLIC_URL, which is the external HTTPS host behind nginx-proxy
// and unreachable from another container without going back out over the
// internet. Defaults to the docker-compose service name for local parity.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://api:3001';

if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
if (!webOrigin) throw new Error('MINI_APP_URL is required (the Mini App URL, e.g. https://zaa4eem.ru)');

const bot = new Bot(token);

// Persistent menu button (bottom-left in Telegram) — always opens the Mini
// App, satisfying FR-021's "entry point that opens the Mini App".
bot.api
  .setChatMenuButton({
    menu_button: { type: 'web_app', text: 'ZAA4EEM', web_app: { url: webOrigin } },
  })
  .catch((err) => {
    console.error('Failed to set menu button:', err);
  });

bot.command('start', async (ctx) => {
  // Personal referral links look like t.me/<bot>?start=ref_CODE — Telegram
  // passes everything after "start=" as this match. The referred account
  // doesn't exist yet at this point, so the API just stashes a pending
  // referral keyed by this Telegram id (see PendingReferral) rather than
  // attributing anything now.
  const payload = ctx.match?.trim();
  if (payload?.startsWith('ref_') && ctx.from) {
    const code = payload.slice(4);
    fetch(`${apiInternalUrl}/api/auth/referral/pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code, telegramId: ctx.from.id }),
    }).catch((err) => console.error('Failed to register pending referral:', err));
  }

  const keyboard = new InlineKeyboard().webApp('Открыть ZAA4EEM 🟢', webOrigin);
  await ctx.reply(
    'ZAA4EEM — идеи и мини-игры.\n\nПредлагай идеи, играй в мини-игры, следи за лентой — всё в одном месте.',
    { reply_markup: keyboard },
  );
});

// One account everywhere: a browser session (logged in via email) generates
// a 6-digit code in Settings → «Привязать Telegram»; sending it here links
// this Telegram identity to that account, so opening the Mini App
// afterwards signs into the same profile instead of creating a new one.
bot.command('link', async (ctx) => {
  const code = ctx.match?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    await ctx.reply('Использование: /link 123456 — код из настроек на сайте (Профиль → Привязать Telegram).');
    return;
  }

  try {
    const res = await fetch(`${apiInternalUrl}/api/auth/link/telegram/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        code,
        telegramId: ctx.from?.id,
        telegramUsername: ctx.from?.username,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await ctx.reply(data.message ?? 'Не удалось привязать аккаунт — попробуй ещё раз.');
      return;
    }
    await ctx.reply('✅ Готово! Этот Telegram теперь открывает тот же аккаунт, что и на сайте.');
  } catch (err) {
    console.error('Telegram link failed:', err);
    await ctx.reply('Не удалось связаться с сервером — попробуй чуть позже.');
  }
});

bot.catch((err) => {
  console.error('Bot error:', err.error);
});

bot.start();
// eslint-disable-next-line no-console
console.log('zaa4eem bot started');
