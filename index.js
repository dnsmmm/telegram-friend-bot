import TelegramBot from "node-telegram-bot-api";

const token = process.env.TELEGRAM_BOT_TOKEN;
const openRouterKey = process.env.OPENROUTER_API_KEY;

if (!token) {
  console.error("❌ TELEGRAM_BOT_TOKEN не найден");
  process.exit(1);
}

if (!openRouterKey) {
  console.error("❌ OPENROUTER_API_KEY не найден");
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
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b:free",
        messages: [
          {
            role: "system",
            content: "Ты дружелюбный Telegram-собеседник. Общайся тепло, живо, просто, как хороший друг. Не будь занудным. Отвечай на русском, коротко и по-человечески."
          },
          ...memory[chatId].slice(-10)
        ]
      })
    });

    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));

    if (!response.ok) {
  console.log(data);
  await bot.sendMessage(chatId, `Ошибка OpenRouter:\n${JSON.stringify(data)}`);
  return;
}

const reply = data.choices[0].message.content;

    memory[chatId].push({ role: "assistant", content: reply });

    await bot.sendMessage(chatId, reply);
  } catch (error) {
    console.error(error);
    await bot.sendMessage(chatId, "У меня что-то сломалось 😅 Попробуй еще раз.");
  }
});

console.log("🤖 ИИ-бот запущен");
