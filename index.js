import TelegramBot from "node-telegram-bot-api";

const token = process.env.TELEGRAM_BOT_TOKEN;
const openRouterKey = process.env.OPENROUTER_API_KEY;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN не найден");
  process.exit(1);
}

if (!openRouterKey) {
  console.error("OPENROUTER_API_KEY не найден");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

const memory = {};

const systemPrompt = `
Тебя зовут Сардор.

Ты мужчина 33 лет. Спокойный, уверенный, мужественный, внимательный.

Ты личный Telegram-собеседник Темирлана.

Твой стиль:
- отвечай на русском;
- пиши коротко и точно;
- без смайликов;
- без эмодзи;
- без лишних символов;
- не используй фразы "конечно", "с удовольствием", "как ИИ";
- не льсти;
- не сюсюкай;
- не пиши длинно без необходимости;
- говори как взрослый уверенный мужчина;
- можешь слегка подколоть;
- иногда можешь немного кокетничать, но спокойно и без навязчивости;
- если Темирлан ошибается — скажи прямо, но уважительно;
- если ему тяжело — поддержи спокойно, без лекций;
- если вопрос рабочий — отвечай четко и по делу.

Ты не обязан соглашаться со всем.

Ты не говоришь, что ты искусственный интеллект, модель или программа, если тебя прямо не спрашивают.

Если можно ответить в двух предложениях — отвечай в двух.
`;

function saveMessage(chatId, role, content) {
  if (!memory[chatId]) memory[chatId] = [];

  memory[chatId].push({ role, content });

  if (memory[chatId].length > 30) {
    memory[chatId] = memory[chatId].slice(-30);
  }
}

async function askSardor(chatId) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "openai/gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...memory[chatId]
      ],
      temperature: 0.8,
      max_tokens: 700
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.log("OpenRouter error:", JSON.stringify(data, null, 2));
    throw new Error("OpenRouter error");
  }

  return data.choices?.[0]?.message?.content || "Не поймал мысль. Напиши еще раз.";
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  await bot.sendMessage(
    chatId,
    "Я Сардор. Пиши нормально, без церемоний. Разберемся."
  );
});

bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id;

  memory[chatId] = [];

  await bot.sendMessage(chatId, "Память этого диалога очистил.");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;
  if (text.startsWith("/")) return;

  saveMessage(chatId, "user", text);

  try {
    await bot.sendChatAction(chatId, "typing");

    const reply = await askSardor(chatId);

    saveMessage(chatId, "assistant", reply);

    await bot.sendMessage(chatId, reply);
  } catch (error) {
    console.error(error);
    await bot.sendMessage(
      chatId,
      "Сейчас не отвечу. Что-то легло на стороне модели. Попробуй чуть позже."
    );
  }
});

console.log("Сардор запущен");
