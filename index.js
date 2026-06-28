import TelegramBot from "node-telegram-bot-api";

const token = process.env.TELEGRAM_BOT_TOKEN;

const bot = new TelegramBot(token, { polling: true });

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (!msg.text) return;

  bot.sendMessage(chatId, `Ты написал: ${msg.text}`);
});

console.log("🤖 Бот запущен");
