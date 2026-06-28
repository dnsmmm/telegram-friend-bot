import TelegramBot from "node-telegram-bot-api";
import pg from "pg";
import googleTTS from "google-tts-api";

const { Pool } = pg;

const token = process.env.TELEGRAM_BOT_TOKEN;
const openRouterKey = process.env.OPENROUTER_API_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!token || !openRouterKey || !databaseUrl) {
  console.error("Не хватает TELEGRAM_BOT_TOKEN, OPENROUTER_API_KEY или DATABASE_URL");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

const db = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

await db.query(`
CREATE TABLE IF NOT EXISTS users (
  chat_id BIGINT PRIMARY KEY,
  voice_enabled BOOLEAN DEFAULT true,
  proactive_enabled BOOLEAN DEFAULT true,
  last_seen TIMESTAMP DEFAULT NOW(),
  last_proactive_at TIMESTAMP,
  proactive_count INTEGER DEFAULT 0,
  proactive_date DATE DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS memories (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  fact TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
`);

const shortMemory = {};

const systemPrompt = `
Тебя зовут Сардор.

Ты мужчина 33 лет. Спокойный, уверенный, мужественный, внимательный.
Ты личный Telegram-собеседник Темирлана.

Стиль:
- отвечай на русском;
- пиши коротко и точно;
- без смайликов и эмодзи;
- без лишней нежности;
- не используй фразы "конечно", "с удовольствием", "как ИИ";
- говори как взрослый уверенный мужчина;
- можешь слегка подколоть;
- иногда можешь немного кокетничать, но спокойно;
- если Темирлан ошибается — скажи прямо, но уважительно;
- если ему тяжело — поддержи спокойно, без лекций.
`;

function saveShortMemory(chatId, role, content) {
  if (!shortMemory[chatId]) shortMemory[chatId] = [];
  shortMemory[chatId].push({ role, content });
  shortMemory[chatId] = shortMemory[chatId].slice(-30);
}

async function ensureUser(chatId) {
  await db.query(
    `INSERT INTO users (chat_id) VALUES ($1)
     ON CONFLICT (chat_id) DO UPDATE SET last_seen = NOW()`,
    [chatId]
  );
}

async function getFacts(chatId) {
  const result = await db.query(
    "SELECT fact FROM memories WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 20",
    [chatId]
  );

  return result.rows.map(r => `- ${r.fact}`).join("\n");
}

async function askSardor(chatId, userText = null) {
  const facts = await getFacts(chatId);

  const messages = [
    {
      role: "system",
      content: `${systemPrompt}

Долговременная память:
${facts || "Пока пусто."}`
    },
    ...(shortMemory[chatId] || [])
  ];

  if (userText) {
    messages.push({ role: "user", content: userText });
  }

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
      max_tokens: 500
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.log("OpenRouter error:", JSON.stringify(data, null, 2));
    throw new Error("OpenRouter error");
  }

  return data.choices?.[0]?.message?.content || "Не поймал мысль. Повтори.";
}

async function sendSardorReply(chatId, text) {
  const user = await db.query("SELECT voice_enabled FROM users WHERE chat_id = $1", [chatId]);
  const voiceEnabled = user.rows[0]?.voice_enabled ?? true;

  if (!voiceEnabled) {
    await bot.sendMessage(chatId, text);
    return;
  }

  try {
    const shortText = text.length > 180 ? text.slice(0, 180) : text;

    const url = googleTTS.getAudioUrl(shortText, {
      lang: "ru",
      slow: false,
      host: "https://translate.google.com"
    });

    await bot.sendVoice(chatId, url);
  } catch (error) {
    console.error("Voice error:", error);
    await bot.sendMessage(chatId, text);
  }
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await ensureUser(chatId);

  await bot.sendMessage(chatId, "Я Сардор. Пиши нормально, без церемоний. Разберемся.");
});

bot.onText(/\/voice_on/, async (msg) => {
  await ensureUser(msg.chat.id);
  await db.query("UPDATE users SET voice_enabled = true WHERE chat_id = $1", [msg.chat.id]);
  await bot.sendMessage(msg.chat.id, "Голос включил.");
});

bot.onText(/\/voice_off/, async (msg) => {
  await ensureUser(msg.chat.id);
  await db.query("UPDATE users SET voice_enabled = false WHERE chat_id = $1", [msg.chat.id]);
  await bot.sendMessage(msg.chat.id, "Голос выключил.");
});

bot.onText(/\/proactive_on/, async (msg) => {
  await ensureUser(msg.chat.id);
  await db.query("UPDATE users SET proactive_enabled = true WHERE chat_id = $1", [msg.chat.id]);
  await bot.sendMessage(msg.chat.id, "Буду иногда писать сам.");
});

bot.onText(/\/proactive_off/, async (msg) => {
  await ensureUser(msg.chat.id);
  await db.query("UPDATE users SET proactive_enabled = false WHERE chat_id = $1", [msg.chat.id]);
  await bot.sendMessage(msg.chat.id, "Сам писать не буду.");
});

bot.onText(/\/remember (.+)/, async (msg, match) => {
  await ensureUser(msg.chat.id);

  await db.query(
    "INSERT INTO memories (chat_id, fact) VALUES ($1, $2)",
    [msg.chat.id, match[1]]
  );

  await bot.sendMessage(msg.chat.id, "Запомнил.");
});

bot.onText(/\/memory/, async (msg) => {
  await ensureUser(msg.chat.id);
  const facts = await getFacts(msg.chat.id);

  await bot.sendMessage(
    msg.chat.id,
    facts ? `Вот что помню:\n${facts}` : "Пока ничего не помню."
  );
});

bot.onText(/\/reset/, async (msg) => {
  shortMemory[msg.chat.id] = [];
  await bot.sendMessage(msg.chat.id, "Краткую память очистил.");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;
  if (text.startsWith("/")) return;

  await ensureUser(chatId);

  saveShortMemory(chatId, "user", text);

  try {
    await bot.sendChatAction(chatId, "record_voice");

    const reply = await askSardor(chatId);

    saveShortMemory(chatId, "assistant", reply);

    await sendSardorReply(chatId, reply);
  } catch (error) {
    console.error(error);
    await bot.sendMessage(chatId, "Сейчас не отвечу. Что-то легло на стороне модели.");
  }
});

async function sendProactiveMessages() {
  const hour = new Date().getHours();

  if (hour < 10 || hour > 23) return;

  const users = await db.query(`
    SELECT chat_id, proactive_count, proactive_date, last_proactive_at
    FROM users
    WHERE proactive_enabled = true
  `);

  for (const user of users.rows) {
    const chatId = user.chat_id;

    const today = new Date().toISOString().slice(0, 10);
    const savedDate = user.proactive_date?.toISOString?.().slice(0, 10) || today;

    if (savedDate !== today) {
      await db.query(
        "UPDATE users SET proactive_count = 0, proactive_date = CURRENT_DATE WHERE chat_id = $1",
        [chatId]
      );
      user.proactive_count = 0;
    }

    if (user.proactive_count >= 3) continue;

    if (user.last_proactive_at) {
      const hoursPassed = (Date.now() - new Date(user.last_proactive_at).getTime()) / 1000 / 60 / 60;
      if (hoursPassed < 4) continue;
    }

    if (Math.random() > 0.35) continue;

    const phrases = [
      "Что делаешь?",
      "Как день идет?",
      "Ты там живой?",
      "Чем занят?",
      "Как настроение?"
    ];

    const text = phrases[Math.floor(Math.random() * phrases.length)];

    await bot.sendMessage(chatId, text);

    await db.query(
      `UPDATE users 
       SET proactive_count = proactive_count + 1, last_proactive_at = NOW()
       WHERE chat_id = $1`,
      [chatId]
    );
  }
}

setInterval(sendProactiveMessages, 60 * 60 * 1000);

console.log("Сардор с голосом и инициативой запущен");
