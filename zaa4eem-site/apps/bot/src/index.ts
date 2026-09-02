import { Bot, InlineKeyboard } from 'grammy';

const token = process.env.TELEGRAM_BOT_TOKEN;
// A single canonical URL (not the comma-separated WEB_ORIGIN CORS list —
// Telegram needs exactly one URL for the Mini App button).
const webOrigin = process.env.MINI_APP_URL;

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
  const keyboard = new InlineKeyboard().webApp('Открыть ZAA4EEM 🟢', webOrigin);
  await ctx.reply(
    'ZAA4EEM — идеи и мини-игры.\n\nПредлагай идеи, играй в мини-игры, следи за лентой — всё в одном месте.',
    { reply_markup: keyboard },
  );
});

bot.catch((err) => {
  console.error('Bot error:', err.error);
});

bot.start();
// eslint-disable-next-line no-console
console.log('zaa4eem bot started');
