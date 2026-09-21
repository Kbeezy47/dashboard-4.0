Incorperate the code in the @instructions.md file into server.ts. Then, update the UI to display these values.

### How the Link Works

The `api_id` and `api_hash` belong to **you** (your Telegram user account), not the bot. They allow your script to log into Telegram as an authorized client just like the Telegram Desktop app open on your screen.

To talk to the bot, your script references its username directly: **`@KryptexMonitoringBot`** (visible in your chat info panel). When your script calls `client.sendMessage("KryptexMonitoringBot", ...)`, it acts exactly as if you typed that message into the chat window yourself.

---

### Parsing Logic & Periodic Polling

Because Telegram accounts will get flood-waited (rate-limited) if messages are sent too aggressively, alternating the commands on an interval (for example, pinging every 10–15 seconds) keeps the session healthy.

Incoming messages from `@KryptexMonitoringBot` are inspected by your event listener, matched against regular expressions, and saved into a structured `miningData` object.

Here is the complete implementation for `server.ts`:

```typescript
// server.ts
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import express from "express";
import cors from "cors";

const BOT_USERNAME = "KryptexMonitoringBot";

// Credentials from my.telegram.org and your .env
const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
const apiHash = process.env.TELEGRAM_API_HASH || "";
const savedSession = process.env.TELEGRAM_SESSION || ""; 

const client = new TelegramClient(new StringSession(savedSession), apiId, apiHash, {
  connectionRetries: 5,
});

// Structured state holding parsed values
export interface MiningStats {
  workerStatus: string;
  currentHashrate: string;
  avgHashrate3H: string;
  totalHashrate30m: string;
  balance: string;
  pending: string;
  profit24h: string;
  lastUpdated: string;
}

const miningData: MiningStats = {
  workerStatus: "offline",
  currentHashrate: "0 TH/s",
  avgHashrate3H: "0 TH/s",
  totalHashrate30m: "0 TH/s",
  balance: "0",
  pending: "0",
  profit24h: "0",
  lastUpdated: "Never",
};

// Regex parsers for bot outputs
function parseBotMessage(text: string) {
  // 1. Parse Workers response
  if (text.includes("Average hashrate") || text.includes("Total hashrate")) {
    // Matches line: "<WorkerName>: <status>, <hashrate>." (e.g., "SSD1: active, 113.91 TH/s.")
    const workerMatch = text.match(/:\s*([a-zA-Z]+),\s*([\d\.]+\s*[A-Za-z\/]+)/);
    if (workerMatch) {
      miningData.workerStatus = workerMatch[1].trim();
      miningData.currentHashrate = workerMatch[2].trim();
    }

    const avgMatch = text.match(/Average hashrate\s*\([^\)]+\):\s*([\d\.]+\s*[A-Za-z\/]+)/i);
    if (avgMatch) miningData.avgHashrate3H = avgMatch[1].trim();

    const totalMatch = text.match(/Total hashrate\s*\([^\)]+\):\s*([\d\.]+\s*[A-Za-z\/]+)/i);
    if (totalMatch) miningData.totalHashrate30m = totalMatch[1].trim();

    miningData.lastUpdated = new Date().toLocaleTimeString();
  }

  // 2. Parse Wallets response
  if (text.includes("Balance:") && text.includes("Left for payment:")) {
    const balanceMatch = text.match(/Balance:\s*([^\n\r]+)/i);
    if (balanceMatch) miningData.balance = balanceMatch[1].replace(/\.$/, "").trim();

    const pendingMatch = text.match(/Left for payment:\s*([^\n\r]+)/i);
    if (pendingMatch) miningData.pending = pendingMatch[1].replace(/\.$/, "").trim();

    const profitMatch = text.match(/Profit for last 24 hours[^:]*:\s*([\d\.]+)/i);
    if (profitMatch) miningData.profit24h = profitMatch[1].trim() + " PRL";

    miningData.lastUpdated = new Date().toLocaleTimeString();
  }
}

async function startServer() {
  const rl = readline.createInterface({ input, output });

  await client.start({
    phoneNumber: async () => await rl.question("Please enter your number: "),
    password: async () => await rl.question("Please enter your 2FA password: "),
    phoneCode: async () => await rl.question("Please enter the code you received: "),
    onError: (err) => console.log("Telegram Auth Error:", err),
  });

  rl.close();
  console.log("Connected to Telegram account.");

  // If you didn't have TELEGRAM_SESSION in .env, copy this output into .env to avoid prompting again
  if (!savedSession) {
    console.log("Save this session string in your .env as TELEGRAM_SESSION:");
    console.log(client.session.save());
  }

  // Event listener for incoming replies from KryptexMonitoringBot
  client.addEventHandler((event: any) => {
    const rawText = event.message?.message;
    if (rawText) {
      parseBotMessage(rawText);
    }
  }, new NewMessage({ chats: [BOT_USERNAME] }));

  // Polling loop: Alternates commands every 10 seconds
  let step = 0;
  setInterval(async () => {
    try {
      if (step % 2 === 0) {
        await client.sendMessage(BOT_USERNAME, { message: "🔨 Workers" });
      } else {
        await client.sendMessage(BOT_USERNAME, { message: "💰 Wallets" });
      }
      step++;
    } catch (err) {
      console.error("Failed to send command to Telegram bot:", err);
    }
  }, 10000);

  // Express API configuration
  const app = express();
  app.use(cors());

  app.get("/api/miner", (_req, res) => {
    res.json(miningData);
  });

  app.listen(3001, () => {
    console.log("Server running on http://localhost:3001");
  });
}

startServer();

```

---

### What `/api/miner` Returns to Your UI

When your React app requests `http://localhost:3001/api/miner`, it receives clean, pre-parsed JSON:

```json
{
  "workerStatus": "active",
  "currentHashrate": "113.91 TH/s",
  "avgHashrate3H": "110.61 TH/s",
  "totalHashrate30m": "90.07 TH/s",
  "balance": "1.413874 PRL (1.29 USD)",
  "pending": "1.413874 / 1.0 PRL (42%)",
  "profit24h": "1.599519 PRL",
  "lastUpdated": "11:52:10 AM"
}

```