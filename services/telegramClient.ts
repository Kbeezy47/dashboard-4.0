import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { round6 } from "./poolBalance";

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

// --- Kryptex bot "Wallets" message parser ------------------------------------
//
// Example (current bot wording):
//   Wallet: prl1...
//   Pool: prl.kryptex.network
//
//   Balance: 0.819305 PRL (1.33 USD).
//   Balance / threshold: 0.819305 / 1.0 PRL (49%).
//   Profit for the last 24 hours / 7 days / 30 days: 0.130563 / 5.543824 / 12.836587 PRL.
//
// IMPORTANT: "Balance: <n> PRL" is the TOTAL (confirmed + unconfirmed), NOT the
// unconfirmed balance. The "(49%)" on the "Balance / threshold" line is
// (confirmed / threshold) * 100, because only confirmed PRL counts toward the
// payout threshold. It is a rounded integer, so the resulting split is only an
// estimate — the exact 6-decimal split comes from the Kryptex pool page.

export interface TelegramBalance {
  total?: number;          // Total pool balance (confirmed + unconfirmed)
  threshold?: number;      // Payout threshold, e.g. 1.0
  thresholdPct?: number;   // Rounded (confirmed / threshold) * 100, e.g. 49
  leftPct?: number;        // Legacy "Left for payment" remaining percentage
  confirmed?: number;      // Estimated confirmed balance (6 decimals)
  unconfirmed?: number;    // Estimated pending balance (6 decimals)
  currency?: string;
  usd?: string;
  profit24h?: string;
  profit7d?: string;
  profit30d?: string;
}

// "Balance: 0.819305 PRL (1.33 USD)."
const BALANCE_LINE_RE =
  /Balance:\s*([\d.,]+)\s*([A-Za-z]+)?\s*(?:\(\s*([\d.,]+)\s*USD\s*\))?/i;

// "Balance / threshold: 0.819305 / 1.0 PRL (49%)."
// Equivalent to the Python regex:
//   r"Balance\s*/\s*threshold:\s*([\d.]+)\s*/\s*([\d.]+)\s*PRL\s*\((\d+)\%\)"
const THRESHOLD_LINE_RE =
  /Balance\s*\/\s*threshold:\s*([\d.]+)\s*\/\s*([\d.]+)\s*PRL\s*\(\s*(\d+)\s*%\s*\)/i;

// Legacy wording: "Left for payment: 1.475789 / 1.0 PRL (28%)."
// Here the percentage is the REMAINING distance to the threshold.
const LEGACY_LEFT_RE =
  /(?:Left for payment|Pending)[^:\n]*:\s*([\d.,]+)\s*\/\s*([\d.,]+)\s*([A-Za-z]+)?\s*(?:\(\s*([\d.,]+)\s*%\s*\))?/i;

// "Profit for the last 24 hours / 7 days / 30 days: 0.130563 / 5.543824 / 12.836587 PRL."
const PROFIT_TRIPLE_RE =
  /Profit for the last 24 hours\s*\/\s*7 days\s*\/\s*30 days:\s*([\d.]+)\s*\/\s*([\d.]+)\s*\/\s*([\d.]+)\s*PRL/i;

// Legacy wording: "Profit for last 24 hours: 0.130563 PRL."
const PROFIT_SINGLE_RE = /Profit for(?: the)? last 24 hours[^:]*:\s*([\d.]+)/i;

function parseAmount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Parses a Kryptex "Wallets" reply into structured values.
 *
 * The confirmed/unconfirmed split derived here is an ESTIMATE based on the
 * bot's rounded integer percentage. It is only used when the exact pool page
 * fetch fails. Returns null when the message contains no wallet information.
 */
export function parseTelegramBalance(text: string): TelegramBalance | null {
  const result: TelegramBalance = {};
  let matched = false;

  const balanceMatch = text.match(BALANCE_LINE_RE);
  if (balanceMatch) {
    result.total = parseAmount(balanceMatch[1]);
    if (balanceMatch[2]) result.currency = balanceMatch[2].trim();
    if (balanceMatch[3]) result.usd = balanceMatch[3].replace(/,/g, "").trim();
    matched = true;
  }

  const thresholdMatch = text.match(THRESHOLD_LINE_RE);
  if (thresholdMatch) {
    const total = parseAmount(thresholdMatch[1]);
    const threshold = parseAmount(thresholdMatch[2]);
    const pct = parseAmount(thresholdMatch[3]);

    if (total !== undefined) result.total = total;
    if (threshold !== undefined) result.threshold = threshold;
    if (pct !== undefined) result.thresholdPct = pct;

    // Fallback estimate: confirmed = threshold * pct, pending = total - confirmed.
    if (total !== undefined && threshold !== undefined && pct !== undefined) {
      const confirmed = round6(threshold * (pct / 100));
      result.confirmed = confirmed;
      result.unconfirmed = round6(Math.max(0, total - confirmed));
    }
    matched = true;
  } else {
    // Legacy "Left for payment" wording: pct is the distance still to go.
    const leftMatch = text.match(LEGACY_LEFT_RE);
    if (leftMatch) {
      const threshold = parseAmount(leftMatch[2]);
      const leftPct = parseAmount(leftMatch[4]);
      if (threshold !== undefined) result.threshold = threshold;
      if (leftPct !== undefined) result.leftPct = leftPct;
      if (leftMatch[3] && !result.currency) result.currency = leftMatch[3].trim();

      const total = result.total;
      if (total !== undefined && threshold !== undefined && leftPct !== undefined) {
        const confirmed = round6(threshold * (1 - leftPct / 100));
        result.confirmed = confirmed;
        result.unconfirmed = round6(Math.max(0, total - confirmed));
      }
      matched = true;
    }
  }

  const profitTriple = text.match(PROFIT_TRIPLE_RE);
  if (profitTriple) {
    result.profit24h = `${profitTriple[1]} PRL`;
    result.profit7d = `${profitTriple[2]} PRL`;
    result.profit30d = `${profitTriple[3]} PRL`;
    matched = true;
  } else {
    const profitSingle = text.match(PROFIT_SINGLE_RE);
    if (profitSingle) {
      result.profit24h = `${profitSingle[1]} PRL`;
      matched = true;
    }
  }

  return matched ? result : null;
}