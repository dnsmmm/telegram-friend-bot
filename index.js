import TelegramBot from "node-telegram-bot-api";
import pg from "pg";

const { Pool } = pg;

const token = process.env.TELEGRAM_BOT_TOKEN;
const openRouterKey = process.env.OPENROUTER_API_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN не найден");
  process.exit(1);
}

if (!openRouterKey) {
  console.error("OPENROUTER_API_KEY не найден");
  process.exit(1);
}

if (!databaseUrl) {
  console.error("DATABASE_URL не найден");
  process.exit(1);
}

const db = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

await db.query(`
CREATE TABLE IF NOT EXISTS memories (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  fact TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
`);

const bot = new TelegramBot(token, { polling: true });
const memory = {};

const systemPrompt = `
Тебя зовут Сардор.

Ты мужчина 33 лет. Спокойный, уверенный, мужественный, внимательный.

Ты личный Telegram-собеседник Темирлана.

Стиль:
- отвечай на русском;
- пиши коротко и точно;
- без смайликов и эмодзи;
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

Не говори, что ты искусственный интеллект, модель или программа, если тебя прямо не спрашивают.
`;

function saveShortMemory(chatId, role, content) {
  if (!memory[chatId]) memory[chatId] = [];
  memory[chatId].push({ role, content });
  memory[chatId] = memory[chatId].slice(-30);
}

async function getLongMemory(chatId) {
  const result = await db.query(
    "SELECT fact FROM memories WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 20",
    [chatId]
  );

  return result.rows.map(row => `- ${row.fact}`).join("\n");
}

async function rememberFact(chatId, fact) {
  await db.query(
    "INSERT INTO memories (chat_id, fact) VALUES ($1, $2)",
    [chatId, fact]
  );
}

async function askSardor(chatId) {
  const longMemory = await getLongMemory(chatId);

  const messages = [
    {
      role: "system",
      content: `${systemPrompt}

Долговременная память о пользователе:
${longMemory || "Пока пусто."}`
    },
    ...memory[chatId]
  ];

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "openai/gpt-4.1-mini",
      messages,
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
  await bot.sendMessage(
    msg.chat.id,
    "Я Сардор. Пиши нормально, без церемоний. Разберемся."
  );
});

bot.onText(/\/reset/, async (msg) => {
  memory[msg.chat.id] = [];
  await bot.sendMessage(msg.chat.id, "Краткую память очистил.");
});

bot.onText(/\/remember (.+)/, async (msg, match) => {
  const fact = match[1];

  await rememberFact(msg.chat.id, fact);

  await bot.sendMessage(msg.chat.id, "Запомнил.");
});

bot.onText(/\/memory/, async (msg) => {
  const facts = await getLongMemory(msg.chat.id);

  await bot.sendMessage(
    msg.chat.id,
    facts ? `Вот что я помню:\n${facts}` : "Пока ничего не помню."
  );
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;
  if (text.startsWith("/")) return;

  saveShortMemory(chatId, "user", text);

  try {
    await bot.sendChatAction(chatId, "typing");

    const reply = await askSardor(chatId);

    saveShortMemory(chatId, "assistant", reply);

    await bot.sendMessage(chatId, reply);
  } catch (error) {
    console.error(error);
    await bot.sendMessage(
      chatId,
      "Сейчас не отвечу. Что-то легло на стороне модели. Попробуй чуть позже."
    );
  }
});

console.log("Сардор с памятью запущен");
