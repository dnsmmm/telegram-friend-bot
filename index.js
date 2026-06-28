import TelegramBot from "node-telegram-bot-api";

const token = process.env.TELEGRAM_BOT_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;

if (!token) {
  console.error("❌ TELEGRAM_BOT_TOKEN не найден");
  process.exit(1);
}

if (!geminiKey) {
  console.error("❌ GEMINI_API_KEY не найден");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const memory = {};

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  if (!memory[chatId]) memory[chatId] = [];

  memory[chatId].push({ role: "user", content: text });

  try {
    await bot.sendChatAction(chatId, "typing");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    "Ты дружелюбный Telegram-собеседник. Общайся тепло, живо, просто, как хороший друг. Отвечай на русском, коротко и по-человечески.\n\n" +
                    memory[chatId]
                      .slice(-10)
                      .map(m => `${m.role === "user" ? "Пользователь" : "Бот"}: ${m.content}`)
                      .join("\n")
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.log(data);
      await bot.sendMessage(chatId, `Ошибка Gemini:\n${JSON.stringify(data)}`);
      return;
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Я подвис 😅 Напиши еще раз.";

    memory[chatId].push({ role: "assistant", content: reply });

    await bot.sendMessage(chatId, reply);
  } catch (error) {
    console.error(error);
    await bot.sendMessage(chatId, "У меня что-то сломалось 😅 Попробуй еще раз.");
  }
});

console.log("🤖 Gemini-бот запущен");
