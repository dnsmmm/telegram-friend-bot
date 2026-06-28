import TelegramBot from "node-telegram-bot-api";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("❌ TELEGRAM_BOT_TOKEN не найден");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (!msg.text) return;

  bot.sendMessage(chatId, `Ты написал: ${msg.text}`);
});

console.log("🤖 Бот запущен через polling");
