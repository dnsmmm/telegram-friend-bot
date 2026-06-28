import TelegramBot from "node-telegram-bot-api";

const token = process.env.TELEGRAM_BOT_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;
const openRouterKey = process.env.OPENROUTER_API_KEY;

if (!token) {
  console.error("❌ TELEGRAM_BOT_TOKEN не найден");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const memory = {};

const systemPrompt =
  "Ты дружелюбный Telegram-собеседник. Общайся тепло, живо, просто, как хороший друг. Отвечай на русском, коротко и по-человечески. Не будь занудным.";

function getHistory(chatId) {
  return memory[chatId]
    .slice(-10)
    .map(m => `${m.role === "user" ? "Пользователь" : "Бот"}: ${m.content}`)
    .join("\n");
}

async function askGemini(chatId) {
  if (!geminiKey) throw new Error("GEMINI_KEY_MISSING");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${systemPrompt}\n\nДиалог:\n${getHistory(chatId)}`
              }
            ]
          }
        ]
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.log("Gemini error:", JSON.stringify(data, null, 2));
    throw new Error("GEMINI_FAILED");
  }

  return data.candidates?.[0]?.content?.parts?.[0]?.text;
}

async function askOpenRouter(chatId) {
  if (!openRouterKey) throw new Error("OPENROUTER_KEY_MISSING");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b:free",
      messages: [
        { role: "system", content: systemPrompt },
        ...memory[chatId].slice(-10)
      ]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.log("OpenRouter error:", JSON.stringify(data, null, 2));
    throw new Error("OPENROUTER_FAILED");
  }

  return data.choices?.[0]?.message?.content;
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  if (!memory[chatId]) memory[chatId] = [];

  memory[chatId].push({ role: "user", content: text });

  try {
    await bot.sendChatAction(chatId, "typing");

    let reply;

    try {
      reply = await askGemini(chatId);
    } catch {
      reply = await askOpenRouter(chatId);
    }

    if (!reply) {
      reply = "Я что-то подвис 😅 Напиши еще раз.";
    }

    memory[chatId].push({ role: "assistant", content: reply });

    await bot.sendMessage(chatId, reply);
  } catch (error) {
    console.error(error);
    await bot.sendMessage(
      chatId,
      "Все бесплатные модели сейчас уперлись в лимит 😅 Попробуй чуть позже."
    );
  }
});

console.log("🤖 Бот 2.0 запущен");
