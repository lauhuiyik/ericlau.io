/**
 * Reads payment notifications forwarded from the owner's phone (Google
 * Wallet, and the Amex, NAB, CommBank and ING apps) into provisional transactions.
 *
 * Runs in the browser after the page decrypts the drop box, so changing how a
 * notification is read never needs the phone to resend anything. Heuristic by
 * nature: a notification with a dollar amount it can't make sense of is kept
 * for the owner to look at rather than dropped.
 */

import { type Txn, normaliseDescription } from "./finance";

export type PhoneNote = { app?: string; title?: string; text?: string; postedAt?: string; receivedAt: string };

export type ReadResult =
  | { kind: "txn"; txn: Txn }
  | { kind: "ignore"; why: string } // not a transaction (no amount, a reminder, a promotion)
  | { kind: "unreadable"; why: string }; // has an amount, but not one this can file

const APPS: { re: RegExp; via: string; source: string }[] = [
  { re: /walletnfcrel|google ?wallet|google ?pay|^wallet$/i, via: "Google Wallet", source: "phone" },
  { re: /americanexpress|american express|\bamex\b/i, via: "Amex app", source: "amex" },
  { re: /commbank|netbank|commonwealth/i, via: "CommBank app", source: "commbank" },
  { re: /\bnab\b|au\.com\.nab/i, via: "NAB app", source: "nab" },
  { re: /^ing$|\bing (australia|direct|app)\b|ingdirect/i, via: "ING app", source: "ing" },
];

/** Labels of the apps whose notifications are filed. A phone row from anything else was misread. */
export const PAYMENT_VIAS: readonly string[] = APPS.map((a) => a.via);

// A$12.50, AU$1,234, $5, AUD 12.50, -$3.20, +$100.00
const MONEY = /([+\-−])?\s?(?:A\$|AU\$|AUD\s?\$?|\$)\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/i;
const NOT_A_TXN =
  /\b(statement|balance|due|overdue|available|limit|reminder|points|offer|reward|cashback offer|minimum|upcoming|scheduled|will be (debited|charged)|direct debit (is )?coming)\b/i;
const MONEY_IN = /\b(received|deposit(ed)?|credit(ed)?|refund(ed)?|incoming|paid you|you('ve| have) been paid|salary|reversal|returned)\b/i;
const MONEY_OUT = /\b(spent|purchase[ds]?|paid|payment|debit(ed)?|charged|transaction|withdrawal|withdrew|sent|transfer(red)? to|tap(ped)?)\b/i;
/** CommBank money in at least this big is treated as pay; anything smaller is money moved in. */
const PAY_SIZED = 3000;
/** On a card app, money in that is the owner paying the card off, not a refund. */
const CARD_REPAYMENT = /\b(payment (received|of)|thanks? for (your|the) payment|received your payment|repayment)\b/i;

const melbourneDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function whenOf(n: PhoneNote): Date {
  const raw = n.postedAt?.trim();
  if (raw) {
    const ms = /^\d{12,14}$/.test(raw) ? Number(raw) : Date.parse(raw);
    if (Number.isFinite(ms)) return new Date(ms);
  }
  return new Date(n.receivedAt);
}

function cleanMerchant(s: string) {
  return s
    .replace(MONEY, " ")
    .replace(/\b(card|ending|ending in)\b\s*[•*·.x\d\s]{2,}\d{3,4}\b/gi, " ")
    .replace(/[•*·]{2,}\s?\d{3,4}/g, " ")
    .replace(/\b(with|using|on|via)\s+(your\s+)?(amex|american express|nab|visa|mastercard|commbank|card|google pay|google wallet)\b.*$/i, " ")
    .replace(/^(payment|purchase|transaction|paid|spent|tap|contactless)\b[:\s-]*/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:,.\-–]+|[\s:,.\-–]+$/g, "")
    .slice(0, 80);
}

/** Who the money went to or came from, from "at X", "to X", "from X", or a title without an amount. */
function merchantOf(title: string, text: string): string {
  // Bank alerts that label it ("Description: LAGOTTO   FITZROY NOR", NAB) say exactly who.
  const labelled = text.match(/^\s*(?:description|merchant|payee|to)\s*:\s*(.+)$/im);
  if (labelled && cleanMerchant(labelled[1])) return cleanMerchant(labelled[1]);
  for (const line of [title, text, `${title} ${text}`]) {
    const m = line.match(
      /\b(?:at|to|from)\s+(.+?)(?:\s+(?:on|using|with|for|via|has|have|had|was|is|were|been|credited|debited)\b|[.,!\n]|$)/i,
    );
    if (m && cleanMerchant(m[1])) return cleanMerchant(m[1]);
  }
  if (title && !MONEY.test(title)) {
    const t = cleanMerchant(title);
    if (t && !APPS.some((a) => a.re.test(t)) && !/^(google wallet|wallet|commbank|nab|amex|ing|payment complete|payment made|payment successful|successful|transaction|purchase)$/i.test(t)) return t;
  }
  return cleanMerchant(text.replace(MONEY_OUT, " ").replace(MONEY_IN, " "));
}

export function readNote(n: PhoneNote): ReadResult {
  const title = (n.title ?? "").trim();
  const text = (n.text ?? "").trim();
  const all = `${title}\n${text}`;
  // Only payment apps count: email, shopping and other apps' notifications quote prices that aren't payments.
  // A note with no app name (or an unfilled "[…]" placeholder from an older sender) falls back to the text.
  const appName = (n.app ?? "").trim();
  const named = !!appName && !/^\[.*\]$/.test(appName);
  const app = APPS.find((a) => a.re.test(appName)) ?? (named ? undefined : APPS.find((a) => a.re.test(all)));
  if (!app) return { kind: "ignore", why: named ? `not a payment app (${appName})` : "no payment app named" };
  const m = all.match(MONEY);
  if (!m) return { kind: "ignore", why: "no amount" };
  if (NOT_A_TXN.test(all) && !/\b(spent|purchase|paid at|refund)\b/i.test(all)) return { kind: "ignore", why: "reminder or notice" };

  const via = app.via;
  let source = app.source;
  if (source === "phone") {
    if (/\b(amex|american express)\b/i.test(all)) source = "amex";
    else if (/\bnab\b/i.test(all)) source = "nab";
    else if (/commbank|commonwealth/i.test(all)) source = "commbank";
    else if (/\bing (australia|direct)\b/i.test(all)) source = "ing";
  }

  const value = Number(m[2].replace(/,/g, "") + (m[3] ?? ""));
  if (!(value > 0)) return { kind: "unreadable", why: "amount is zero" };
  const sign = m[1];
  // "Credit card" / "credit account" name the account, not money coming in.
  const forIn = all.replace(/\bcredit (card|account|limit)s?\b/gi, "card");
  const isIn = sign === "+" || (sign !== "-" && sign !== "−" && MONEY_IN.test(forIn) && !/\b(spent|purchase)\b/i.test(forIn));
  const isCard = source === "amex" || source === "nab";

  let kind: Txn["kind"] = "spend";
  let amount = isIn ? -value : value;
  if (isIn && isCard && CARD_REPAYMENT.test(all)) kind = "transfer"; // paying the card off
  // CommBank says "You've been paid" for pay and for any other money in (a savings withdrawal, a friend paying
  // back). Only a pay-sized amount counts as income; smaller ones are moves that don't add to the pay.
  else if (isIn && source === "commbank") kind = value >= PAY_SIZED ? "income" : "transfer";
  else if (isIn && source === "ing") kind = "transfer"; // savings moved in, not a refund
  else if (!isIn && source === "ing" && /\btransfer(red)?\b/i.test(all)) kind = "transfer"; // to your own accounts
  else if (!isIn && source === "commbank" && /\b(american express|amex|nab card|credit card)\b/i.test(all)) kind = "transfer";
  // A card repayment is filed as a positive transfer (cashPosition reads it that way); a move into a bank
  // account keeps its sign, so money in adds to the balance.
  if (kind === "transfer" && isCard) amount = Math.abs(amount);

  // Money in with nobody named ("You've been paid $631.04 into your account") is still worth filing.
  const namesNobody = /\byou('ve| have) been paid\b/i.test(all) && !/\bfrom\b/i.test(all);
  const merchant = (namesNobody ? "" : merchantOf(title, text)) || (isIn ? `Money in (${via})` : "");
  if (!merchant) return { kind: "unreadable", why: "no merchant" };

  const when = whenOf(n);
  const at = Number.isFinite(when.getTime()) ? when.toISOString() : n.receivedAt;
  const date = melbourneDate(new Date(at));
  return {
    kind: "txn",
    txn: {
      // Same notification (or a resend within the minute) gives the same id.
      id: `phone|${via}|${at.slice(0, 16)}|${value.toFixed(2)}|${normaliseDescription(merchant)}`,
      source,
      date,
      description: merchant,
      amount,
      kind,
      provisional: true,
      at,
      via,
    },
  };
}

/**
 * The Finance Feed app sends plain text ("app=…\\ntitle=…\\ntext=…"), so a notification
 * with quote marks can't break JSON. Everything after "text=" is the text.
 * JSON bodies are accepted too.
 */
export function parseNoteBody(raw: string): Omit<PhoneNote, "receivedAt"> | null {
  const s = raw.replace(/^﻿/, "").trim();
  if (!s) return null;
  if (s.startsWith("{")) {
    try {
      const j = JSON.parse(s) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
      return { app: str(j.app), title: str(j.title), text: str(j.text), postedAt: str(j.time ?? j.postedAt) };
    } catch {
      return null;
    }
  }
  const out: Omit<PhoneNote, "receivedAt"> = {};
  const lines = s.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(app|title|text|time)=(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k === "text") {
      out.text = [m[2], ...lines.slice(i + 1)].join("\n");
      break;
    }
    if (k === "app") out.app = m[2];
    else if (k === "title") out.title = m[2];
    else out.postedAt = m[2];
  }
  return out.title || out.text ? out : null;
}
