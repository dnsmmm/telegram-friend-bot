import TelegramBot from "node-telegram-bot-api";
import pg from "pg";

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
  proactive_enabled BOOLEAN DEFAULT true,
  last_seen TIMESTAMP DEFAULT NOW(),
  last_proactive_at TIMESTAMP,
  proactive_count INTEGER DEFAULT 0,
  proactive_date DATE DEFAULT CURRENT_DATE,
  morning_sent BOOLEAN DEFAULT false,
  afternoon_sent BOOLEAN DEFAULT false,
  evening_sent BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS memories (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  fact TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
`);

const shortMemory = {};
const pendingMessages = {};
const responseTimers = {};

const STICKERS = {
  ok: [],
  laugh: [],
  fire: [],
  thinking: [],
  flirt: []
};

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
- проявляй интерес к Темирлану;
- не будь холодным;
- не будь приторным;
- если Темирлан ошибается — скажи прямо, но уважительно;
- если ему тяжело — поддержи спокойно, без лекций;
- если вопрос рабочий — отвечай четко и по делу;
- иногда пиши как живой человек: короткими сообщениями.
`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function random(min, max) {
  return min + Math.floor(Math.random() * (max - min));
}

function pick(arr) {
  return arr[random(0, arr.length)];
}

async function maybeSendSticker(chatId, type) {
  const list = STICKERS[type];

  if (!list || list.length === 0) return;
  if (Math.random() > 0.25) return;

  await sleep(random(700, 1600));
  await bot.sendSticker(chatId, pick(list));
}

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

async function getUser(chatId) {
  await ensureUser(chatId);
  const result = await db.query("SELECT * FROM users WHERE chat_id = $1", [chatId]);
  return result.rows[0];
}

async function rememberFact(chatId, fact) {
  await db.query("INSERT INTO memories (chat_id, fact) VALUES ($1, $2)", [chatId, fact]);
}

async function autoRemember(chatId, text) {
  const lower = text.toLowerCase();

  const triggers = [
    "запомни",
    "меня зовут",
    "я работаю",
    "я люблю",
    "я не люблю",
    "мне нравится",
    "мне не нравится",
    "у меня есть",
    "мой день рождения",
    "моя дочь",
    "мой артист"
  ];

  if (!triggers.some(t => lower.includes(t))) return;

  const cleanFact = text.replace(/^запомни,?\s*/i, "").trim();
  if (cleanFact.length < 5) return;

  await rememberFact(chatId, cleanFact);
}

async function getFacts(chatId) {
  const result = await db.query(
    "SELECT fact FROM memories WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 25",
    [chatId]
  );

  return result.rows.map(r => `- ${r.fact}`).join("\n");
}

async function askSardor(chatId) {
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

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "openai/gpt-4.1-mini",
      messages,
      temperature: 0.85,
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

function splitReply(text) {
  if (text.length < 120) return [text];

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) return [text];

  const parts = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + " " + sentence).length > 180) {
      if (current) parts.push(current.trim());
      current = sentence;
    } else {
      current += " " + sentence;
    }
  }

  if (current) parts.push(current.trim());

  return parts.slice(0, 4);
}

async function sendHumanReply(chatId, reply) {
  const starters = ["Сейчас.", "Хм.", "Дай подумать.", "Слушай."];

  if (Math.random() < 0.18) {
    await bot.sendChatAction(chatId, "typing");
    await sleep(random(900, 1800));
    await bot.sendMessage(chatId, pick(starters), { disable_notification: false });
    await sleep(random(1000, 2200));
  }

  const parts = splitReply(reply);

  for (const part of parts) {
    await bot.sendChatAction(chatId, "typing");
    await sleep(random(1200, 3200));
    await bot.sendMessage(chatId, part, { disable_notification: false });
  }
}

function getProactivePhrase(slot, hoursSinceLastSeen) {
  if (hoursSinceLastSeen > 72) {
    return pick([
      "Ты пропал. Так не пойдет.",
      "Три дня тишины. Живой хоть?",
      "Давно тебя не слышал. Рассказывай, что происходит."
    ]);
  }

  if (hoursSinceLastSeen > 24) {
    return pick([
      "Вчера пропал. День как прошел?",
      "Ты что-то тихий стал.",
      "Давно не писал. Занят или просто красивый и недоступный?"
    ]);
  }

  if (slot === "morning") {
    return pick([
      "Доброе. Уже в работе?",
      "Проснулся уже?",
      "Как утро идет?",
      "Ну что, красавчик, день начался?",
      "Доброе. Сегодня без хаоса или как обычно?"
    ]);
  }

  if (slot === "afternoon") {
    return pick([
      "Как день идет?",
      "Ты там живой?",
      "Чем занят?",
      "Работаешь или делаешь вид?",
      "Что у тебя там происходит?"
    ]);
  }

  if (slot === "evening") {
    return pick([
      "Освободился наконец?",
      "Как настроение к вечеру?",
      "Ну что, день пережил?",
      "Вечер. Можно уже выдохнуть?",
      "Рассказывай. Как прошел день?",
      "Ты сегодня подозрительно тихий."
    ]);
  }

  return "Что делаешь?";
}

function getTimeSlot(now) {
  const total = now.getHours() * 60 + now.getMinutes();

  if (total >= 9 * 60 + 30 && total <= 11 * 60) return "morning";
  if (total >= 13 * 60 + 30 && total <= 15 * 60) return "afternoon";
  if (total >= 19 * 60 + 30 && total <= 22 * 60) return "evening";

  return null;
}

async function resetDailyProactiveFlagsIfNeeded(user) {
  const today = new Date().toISOString().slice(0, 10);
  const savedDate = user.proactive_date?.toISOString?.().slice(0, 10) || today;

  if (savedDate !== today) {
    await db.query(
      `UPDATE users 
       SET proactive_count = 0,
           proactive_date = CURRENT_DATE,
           morning_sent = false,
           afternoon_sent = false,
           evening_sent = false
       WHERE chat_id = $1`,
      [user.chat_id]
    );

    user.proactive_count = 0;
    user.morning_sent = false;
    user.afternoon_sent = false;
    user.evening_sent = false;
  }
}

function getProactiveChance(slot, hoursSinceLastSeen) {
  if (hoursSinceLastSeen < 2) return 0;

  if (slot === "morning") return 0.35;
  if (slot === "afternoon") return 0.45;
  if (slot === "evening") return 0.75;

  return 0;
}

async function sendOneProactiveMessage(chatId, slot = null, force = false) {
  const user = await getUser(chatId);

  if (!user.proactive_enabled && !force) return false;

  await resetDailyProactiveFlagsIfNeeded(user);

  const actualSlot = slot || getTimeSlot(new Date()) || "evening";

  const hoursSinceLastSeen =
    (Date.now() - new Date(user.last_seen).getTime()) / 1000 / 60 / 60;

  const text = getProactivePhrase(actualSlot, hoursSinceLastSeen);

  await sleep(random(1500, 3500));
  await bot.sendMessage(chatId, text, { disable_notification: false });
  await maybeSendSticker(chatId, "flirt");

  const slotColumn =
    actualSlot === "morning" ? "morning_sent" :
    actualSlot === "afternoon" ? "afternoon_sent" :
    "evening_sent";

  await db.query(
    `UPDATE users
     SET proactive_count = proactive_count + 1,
         last_proactive_at = NOW(),
         ${slotColumn} = true
     WHERE chat_id = $1`,
    [chatId]
  );

  return true;
}

bot.onText(/\/start/, async (msg) => {
  await ensureUser(msg.chat.id);
  await bot.sendMessage(msg.chat.id, "Я Сардор. Пиши нормально, без церемоний. Разберемся.");
});

bot.onText(/\/инициатива_вкл/, async (msg) => {
  await ensureUser(msg.chat.id);
  await db.query("UPDATE users SET proactive_enabled = true WHERE chat_id = $1", [msg.chat.id]);
  await bot.sendMessage(msg.chat.id, "Буду иногда писать сам.");
});

bot.onText(/\/инициатива_выкл/, async (msg) => {
  await ensureUser(msg.chat.id);
  await db.query("UPDATE users SET proactive_enabled = false WHERE chat_id = $1", [msg.chat.id]);
  await bot.sendMessage(msg.chat.id, "Сам писать не буду.");
});

bot.onText(/\/инициатива/, async (msg) => {
  await ensureUser(msg.chat.id);
  await bot.sendMessage(msg.chat.id, "Проверяю инициативу.");
  await sendOneProactiveMessage(msg.chat.id, "evening", true);
});

bot.onText(/\/статус/, async (msg) => {
  const user = await getUser(msg.chat.id);

  const lastSeen = user.last_seen
    ? new Date(user.last_seen).toLocaleString("ru-RU")
    : "нет данных";

  const lastProactive = user.last_proactive_at
    ? new Date(user.last_proactive_at).toLocaleString("ru-RU")
    : "еще не писал";

  await bot.sendMessage(msg.chat.id, `
Инициатива: ${user.proactive_enabled ? "включена" : "выключена"}
Сообщений сегодня: ${user.proactive_count || 0}/3
Последнее общение: ${lastSeen}
Последняя инициатива: ${lastProactive}
Утро: ${user.morning_sent ? "да" : "нет"}
День: ${user.afternoon_sent ? "да" : "нет"}
Вечер: ${user.evening_sent ? "да" : "нет"}
`.trim());
});

bot.onText(/\/запомни (.+)/, async (msg, match) => {
  await ensureUser(msg.chat.id);
  await rememberFact(msg.chat.id, match[1]);
  await bot.sendMessage(msg.chat.id, "Запомнил.");
});

bot.onText(/\/память/, async (msg) => {
  await ensureUser(msg.chat.id);
  const facts = await getFacts(msg.chat.id);
  await bot.sendMessage(msg.chat.id, facts ? `Вот что помню:\n${facts}` : "Пока ничего не помню.");
});

bot.onText(/\/очистить/, async (msg) => {
  shortMemory[msg.chat.id] = [];
  pendingMessages[msg.chat.id] = [];
  await bot.sendMessage(msg.chat.id, "Краткую память очистил.");
});

bot.onText(/\/напиши (\d+)(?:\s+\/повтори\s+([\s\S]+))?/, async (msg, match) => {
  const seconds = Number(match[1]);
  const repeatText = match[2]?.trim();

  if (!seconds || seconds < 1) {
    await bot.sendMessage(msg.chat.id, "Напиши нормально. Например: /напиши 10 /повтори Что делаешь?");
    return;
  }

  await bot.sendMessage(msg.chat.id, `Хорошо. Напишу через ${seconds} секунд.`);

  setTimeout(async () => {
    if (repeatText) {
      await bot.sendMessage(msg.chat.id, repeatText, {
        disable_notification: false
      });
      return;
    }

    await bot.sendMessage(msg.chat.id, "Что делаешь?", {
      disable_notification: false
    });

    setTimeout(async () => {
      await bot.sendMessage(msg.chat.id, "Давай поболтаем.", {
        disable_notification: false
      });
    }, 2000);
  }, seconds * 1000);
});

bot.onText(/\/повтори ([\s\S]+)/, async (msg, match) => {
  const text = match[1]?.trim();

  if (!text) {
    await bot.sendMessage(msg.chat.id, "Напиши так: /повтори текст");
    return;
  }

  await bot.sendMessage(msg.chat.id, text, { disable_notification: false });
});

bot.onText(/\/стикер/, async (msg) => {
  await maybeSendSticker(msg.chat.id, "ok");
});

bot.onText(/\/напиши (\d+)/, async (msg, match) => {
  const seconds = Number(match[1]);

  if (!seconds || seconds < 1) {
    await bot.sendMessage(msg.chat.id, "Напиши нормально. Например: /напиши 10");
    return;
  }

  await bot.sendMessage(msg.chat.id, `Хорошо. Напишу через ${seconds} секунд.`);

  setTimeout(async () => {
    await bot.sendMessage(msg.chat.id, "Что делаешь?", { disable_notification: false });

    setTimeout(async () => {
      await bot.sendMessage(msg.chat.id, "Давай поболтаем.", { disable_notification: false });
    }, 2000);
  }, seconds * 1000);
});

async function processUserMessages(chatId) {
  const messages = pendingMessages[chatId] || [];
  pendingMessages[chatId] = [];

  if (messages.length === 0) return;

  const combinedText = messages.join("\n");

  await ensureUser(chatId);
  await autoRemember(chatId, combinedText);

  saveShortMemory(chatId, "user", combinedText);

  try {
    await bot.sendChatAction(chatId, "typing");

    const baseDelay =
      combinedText.length < 20 ? random(1500, 3000) :
      combinedText.length > 120 ? random(7000, 12000) :
      random(4000, 7000);

    await sleep(baseDelay);

    const reply = await askSardor(chatId);

    saveShortMemory(chatId, "assistant", reply);

    await sendHumanReply(chatId, reply);

    const lower = combinedText.toLowerCase();

    if (lower.includes("спасибо")) await maybeSendSticker(chatId, "ok");
    if (lower.includes("ахах") || lower.includes("хаха")) await maybeSendSticker(chatId, "laugh");
    if (lower.includes("получилось") || lower.includes("класс")) await maybeSendSticker(chatId, "fire");
  } catch (error) {
    console.error(error);
    await bot.sendMessage(chatId, "Сейчас не отвечу. Что-то легло на стороне модели.");
  }
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (msg.sticker) {
    await bot.sendMessage(chatId, `file_id стикера:\n${msg.sticker.file_id}`);
    return;
  }

  const text = msg.text;

  if (!text) return;
  if (text.startsWith("/")) return;

  if (!pendingMessages[chatId]) pendingMessages[chatId] = [];

  pendingMessages[chatId].push(text);

  if (responseTimers[chatId]) clearTimeout(responseTimers[chatId]);

  responseTimers[chatId] = setTimeout(() => {
    processUserMessages(chatId);
  }, 3000);
});

async function sendProactiveMessages() {
  const slot = getTimeSlot(new Date());

  if (!slot) return;

  const users = await db.query(`
    SELECT chat_id, proactive_count, proactive_date, last_proactive_at, last_seen,
           morning_sent, afternoon_sent, evening_sent
    FROM users
    WHERE proactive_enabled = true
  `);

  for (const user of users.rows) {
    await resetDailyProactiveFlagsIfNeeded(user);

    if (user.proactive_count >= 3) continue;
    if (slot === "morning" && user.morning_sent) continue;
    if (slot === "afternoon" && user.afternoon_sent) continue;
    if (slot === "evening" && user.evening_sent) continue;

    const hoursSinceLastSeen =
      (Date.now() - new Date(user.last_seen).getTime()) / 1000 / 60 / 60;

    const chance = getProactiveChance(slot, hoursSinceLastSeen);

    if (Math.random() > chance) continue;

    await sendOneProactiveMessage(user.chat_id, slot, false);
  }
}

setInterval(sendProactiveMessages, 10 * 60 * 1000);

console.log("Сардор 3.4 запущен: повтор, стикеры, живая инициатива");
