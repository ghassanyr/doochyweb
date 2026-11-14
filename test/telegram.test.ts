import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SignalView } from "../src/server/signals/types";
import { parseCommand } from "../src/server/telegram/bot";
import { telegramConfig, telegramConfigFromValues, telegramDeepLink } from "../src/server/telegram/config";
import {
  generateLinkCode,
  hashLinkCode,
  isValidLinkCodeFormat,
  normalizeLinkCode,
} from "../src/server/telegram/link";
import {
  buildInvalidCodeMessage,
  buildNotLinkedMessage,
  buildPublishedMessage,
  buildTestMessage,
  buildWelcomeMessage,
  escapeHtml,
  fmtPrice,
  formatUtc,
  signalButtonUrl,
} from "../src/server/telegram/messages";
import { retryDelayMs } from "../src/server/telegram/notify";

const signal: SignalView = {
  id: "507f1f77bcf86cd799439011",
  symbol: "XAUUSD",
  direction: "buy",
  entry: 2400,
  entryMax: null,
  target: 2450,
  target2: null,
  target3: null,
  stop: 2380,
  timeframe: "4h",
  note: "Breakout retest",
  status: "active",
  expiresAt: "2026-11-12T14:00:00.000Z",
  createdAt: "2026-11-11T10:00:00.000Z",
  updatedAt: "2026-11-11T10:00:00.000Z",
  invalidatedAt: null,
  invalidationReason: null,
  resolvedAt: null,
  resolution: null,
  updates: [],
};

describe("telegram config", () => {
  test("is disabled without a token", () => {
    const config = telegramConfig({});
    assert.equal(config.enabled, false);
    assert.equal("mode" in config, false);
    assert.equal(config.baseUrl, "");
    assert.equal(config.botUsername, "DoochyBot");
    assert.equal(config.linkTtlMinutes, 15);
  });

  test("normalizes the token, username and base URL", () => {
    const config = telegramConfig({
      TELEGRAM_BOT_TOKEN: " 123:abc ",
      TELEGRAM_BOT_USERNAME: "@DoochyBot",
      PUBLIC_BASE_URL: "https://doochy.net/",
    });
    assert.equal(config.enabled, true);
    assert.equal(config.token, "123:abc");
    assert.equal(config.botUsername, "DoochyBot");
    assert.equal(config.baseUrl, "https://doochy.net");
    assert.equal(telegramDeepLink("ABCDEFGHJK", config), "https://t.me/DoochyBot?start=ABCDEFGHJK");
  });

  test("honours TELEGRAM_ENABLED=false even with a token", () => {
    const config = telegramConfig({ TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_ENABLED: "false" });
    assert.equal(config.enabled, false);
  });

  test("clamps the TTL", () => {
    const config = telegramConfig({
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_LINK_TTL_MINUTES: "999",
    });
    assert.equal(config.linkTtlMinutes, 60);
  });

  test("accepts resolved values and uses the canonical site URL", () => {
    const config = telegramConfigFromValues(
      {
        botToken: " 123:abc ",
        botUsername: "@MyBot",
        baseUrl: "https://legacy.example/",
        enabled: true,
        linkTtlMinutes: 5,
      },
      "https://example.com/app"
    );
    assert.deepEqual(config, {
      enabled: true,
      token: "123:abc",
      botUsername: "MyBot",
      baseUrl: "https://example.com",
      brandName: "Doochy",
      linkTtlMinutes: 5,
    });
  });

  test("derives the fallback bot username from the configured brand", () => {
    const config = telegramConfigFromValues(
      { botToken: "123:abc" },
      "https://example.com",
      "Acme Trading"
    );
    assert.equal(config.botUsername, "AcmeTradingBot");
    assert.equal(config.brandName, "Acme Trading");
  });

  test("ignores a stored legacy base URL without a canonical site URL", () => {
    const config = telegramConfigFromValues({
      botToken: "123:abc",
      baseUrl: "https://legacy.example",
    });
    assert.equal(config.baseUrl, "");
    assert.equal(config.enabled, true);
  });

  test("stays disabled when the database flag is off", () => {
    const config = telegramConfigFromValues({
      botToken: "123:abc",
      enabled: false,
    });
    assert.equal(config.enabled, false);
  });
});

describe("link codes", () => {
  test("normalizes separators and Crockford-ambiguous characters", () => {
    assert.equal(normalizeLinkCode(" abcd-efgh "), "ABCDEFGH");
    assert.equal(normalizeLinkCode("OIL"), "011");
  });

  test("generates a deterministic code from random bytes", () => {
    assert.equal(generateLinkCode(10, () => Buffer.alloc(10, 0)), "0000000000");
    assert.equal(
      generateLinkCode(10, () => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])),
      "0123456789"
    );
  });

  test("hashes the normalized code", () => {
    assert.equal(hashLinkCode("abcd-efgh"), hashLinkCode("ABCDEFGH"));
    assert.match(hashLinkCode("ABC"), /^[a-f0-9]{64}$/);
  });

  test("validates the code shape", () => {
    assert.equal(isValidLinkCodeFormat("ABCDEFGHJK"), true);
    assert.equal(isValidLinkCodeFormat("ABCDEFGHUJ"), false);
    assert.equal(isValidLinkCodeFormat("ABC"), false);
  });
});

describe("bot command parsing", () => {
  test("parses /start with and without a code", () => {
    assert.deepEqual(parseCommand("/start ABCDEFGHJK"), {
      kind: "start",
      code: "ABCDEFGHJK",
      hasCodeArg: true,
    });
    assert.deepEqual(parseCommand("/start@DoochyBot abcdefghjk"), {
      kind: "start",
      code: "ABCDEFGHJK",
      hasCodeArg: true,
    });
    assert.deepEqual(parseCommand("/start"), { kind: "start", code: null, hasCodeArg: false });
  });

  test("accepts a bare code as a link attempt", () => {
    assert.deepEqual(parseCommand("ABCDEFGHJK"), {
      kind: "start",
      code: "ABCDEFGHJK",
      hasCodeArg: true,
    });
  });

  test("parses lifecycle commands, including @bot suffixes", () => {
    assert.deepEqual(parseCommand("/status"), { kind: "status" });
    assert.deepEqual(parseCommand("/stop@DoochyBot"), { kind: "stop" });
    assert.deepEqual(parseCommand("/mute"), { kind: "stop" });
    assert.deepEqual(parseCommand("/resume"), { kind: "resume" });
    assert.deepEqual(parseCommand("/unmute"), { kind: "resume" });
    assert.deepEqual(parseCommand("/unlink"), { kind: "unlink" });
    assert.deepEqual(parseCommand("/help"), { kind: "help" });
  });

  test("rejects unknown commands and plain chatter", () => {
    assert.deepEqual(parseCommand("/nope"), { kind: "unknown" });
    assert.deepEqual(parseCommand("hello there"), { kind: "unknown" });
    assert.deepEqual(parseCommand(""), { kind: "unknown" });
  });
});

describe("telegram messages", () => {
  test("escapes Telegram HTML", () => {
    assert.equal(escapeHtml("a & b <script>"), "a &amp; b &lt;script&gt;");
  });

  test("formats prices with magnitude-aware decimals", () => {
    assert.equal(fmtPrice(2400), "2400.00");
    assert.equal(fmtPrice(1.234567), "1.2346");
    assert.equal(fmtPrice(null), "-");
  });

  test("builds a complete publish message", () => {
    const text = buildPublishedMessage(signal);
    assert.match(text, /New signal/);
    assert.match(text, /XAUUSD <b>BUY<\/b>/);
    assert.match(text, /Entry <code>2400\.00<\/code>/);
    assert.match(text, /TP1 <code>2450\.00<\/code>/);
    assert.match(text, /Stop <code>2380\.00<\/code>/);
    assert.match(text, /R:R 2\.50/);
    assert.match(text, /4h/);
    assert.match(text, /Breakout retest/);
    assert.match(text, /Expires .* UTC/);
  });

  test("includes an entry range and uses its midpoint for R:R", () => {
    const text = buildPublishedMessage({ ...signal, entry: 2400, entryMax: 2410 });
    assert.match(text, /Entry <code>2400\.00–2410\.00<\/code>/);
    assert.match(text, /R:R 1\.80/);
  });

  test("includes TP2 and TP3 when present", () => {
    const text = buildPublishedMessage({ ...signal, target2: 2460, target3: 2470 });
    assert.match(text, /TP2 <code>2460\.00<\/code>/);
    assert.match(text, /TP3 <code>2470\.00<\/code>/);
  });

  test("escapes dynamic text in the publish message", () => {
    const text = buildPublishedMessage({
      ...signal,
      symbol: "X<Y",
      note: "a & b <script>",
    });
    assert.ok(text.includes("X&lt;Y"));
    assert.ok(text.includes("a &amp; b &lt;script&gt;"));
    assert.ok(!text.includes("<script>"));
  });

  test("omits optional fields cleanly", () => {
    const text = buildPublishedMessage({
      ...signal,
      entry: null,
      timeframe: null,
      note: "",
      expiresAt: null,
    });
    assert.ok(!text.includes("Entry"));
    assert.ok(!text.includes("R:R"));
    assert.ok(!text.includes("Expires"));
  });

  test("builds the deep link button URL", () => {
    assert.equal(
      signalButtonUrl("https://doochy.net/", "507f1f77bcf86cd799439011"),
      "https://doochy.net/signals?signal=507f1f77bcf86cd799439011"
    );
    assert.equal(signalButtonUrl("", "507f1f77bcf86cd799439011"), null);
  });

  test("omits settings links when no public URL is configured", () => {
    const welcome = buildWelcomeMessage("", "Acme");
    assert.match(welcome, /Connect Telegram/);
    assert.doesNotMatch(welcome, /<a href=/);
    assert.match(buildInvalidCodeMessage(""), /Generate a new one in Settings\./);
    assert.equal(
      buildNotLinkedMessage(""),
      "This chat is not linked. Open Settings to connect it."
    );
  });

  test("formats UTC timestamps and test messages", () => {
    const formatted = formatUtc("2026-11-12T14:00:00.000Z");
    assert.ok(formatted?.includes("Nov 2026"));
    assert.ok(formatted?.includes("14:00"));
    assert.match(buildTestMessage(), /notifications are working/);
    assert.match(buildTestMessage("Acme"), /<b>Acme test<\/b>/);
    assert.match(buildTestMessage("<Acme>"), /&lt;Acme&gt;/);
  });
});

describe("outbox retry delay", () => {
  test("backs off exponentially and caps at 30 minutes", () => {
    assert.equal(retryDelayMs(1), 15_000);
    assert.equal(retryDelayMs(2), 30_000);
    assert.equal(retryDelayMs(3), 60_000);
    assert.equal(retryDelayMs(20), 30 * 60_000);
  });
});
