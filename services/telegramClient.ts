import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
const apiHash = process.env.TELEGRAM_API_HASH || "";
const savedSession = process.env.TELEGRAM_SESSION || "";

export const client = new TelegramClient(new StringSession(savedSession), apiId, apiHash, {
  connectionRetries: 5,
});

export async function initTelegram() {
  console.log("Connecting to Telegram...");
  
  // Initialize the native Node readline interface
  const rl = readline.createInterface({ input, output });
  
  await client.start({
    phoneNumber: async () => await rl.question("Please enter your number: "),
    password: async () => await rl.question("Please enter your 2FA password: "),
    phoneCode: async () => await rl.question("Please enter the code you received: "),
    onError: (err) => console.log("Telegram Error:", err),
  });

  // Close the prompt interface once connected
  rl.close();

  console.log("Connected to Telegram account.");

  // If you didn't have TELEGRAM_SESSION in .env, copy this output into .env to avoid prompting again
  if (!savedSession) {
    console.log("Save this session string in your .env as TELEGRAM_SESSION:");
    console.log(client.session.save());
  }
}