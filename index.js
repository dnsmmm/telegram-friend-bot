import TelegramBot from "node-telegram-bot-api";

const token = process.env.TELEGRAM_BOT_TOKEN;
const port = process.env.PORT || 3000;
const appUrl = process.env.RAILWAY_PUBLIC_DOMAIN;

const bot = new TelegramBot(token, { webHook: { port } });

bot.setWebHook(`https://${appUrl}/bot${token}`);

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (!msg.text) return;

  bot.sendMessage(chatId, `Ты написал: ${msg.text}`);
});

console.log("🤖 Бот запущен через webhook");
