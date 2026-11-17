import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { simpleParser } from "mailparser";

import {
  IMAP_PRESETS,
  asImapValues,
  validateImapSetup,
} from "../src/server/integrations/imapSetup";
import {
  forwardChain,
  matchesFilters,
} from "../src/server/sessionAnalysis/ingest";
import {
  imageSize,
  isChartImage,
  pairImages,
  parseGeneratedAt,
  parseMarkets,
  parseSession,
  parseSessionName,
  normalizeSessionName,
  type ImageSize,
} from "../src/server/sessionAnalysis/parse";
import type { ParsedImage, ParsedMarket } from "../src/server/sessionAnalysis/types";
import {
  imageById,
  isLegacyDuplicate,
  SessionAnalysisImageModel,
  storedBuffer,
} from "../src/server/sessionAnalysis/store";

const EMAIL_TEXT = `AI Market Analysis
17-Nov-2026 06:14 EST

BTCUSD | Target Level 63564.0977
Target Period
: 10 hours
Interval
: 1 hour
Pattern
: Support
Identified
: 17-Nov-06:00
Broke through Support level of 64251.6914 at
17-Nov-06:00
Supported by Downward sloping Moving
Average
Trade Now

DAX 40 | Target Level 25849.8333
Target Period
: 2 days
Interval
: 4 hour
Pattern
: Channel Up
Identified
: 16-Nov-11:00
Channel Up identified at 16-Nov-11:00. This
pattern is still in the process of forming. Possible
bearish price movement towards the support
25849.8333 within the next 2 days.
Supported by Downward sloping Moving
Average
Resistance
:
(A
) 27011.0000 Latest turning point of Channel
Up
Trade Now

EURUSD | Target Level 1.0939
Target Period
: 2 days
Interval
: 30 Minutes
Pattern
: Falling Wedge
Identified
: 17-Nov-05:30
Falling Wedge identified at 17-Nov-05:30.
Supported by Downward sloping Moving Average
Resistance
: (A) 1.1010 Latest turning point of Falling Wedge
Trade Now
`;

describe("session analysis parsing", () => {
  test("reads every market card from the email text", () => {
    const markets = parseMarkets(EMAIL_TEXT);
    assert.deepEqual(
      markets.map((market) => market.symbol),
      ["BTCUSD", "DAX 40", "EURUSD"]
    );
  });

  test("keeps the target, interval, pattern and identified stamp", () => {
    const [btc, dax, eur] = parseMarkets(EMAIL_TEXT);
    assert.ok(btc && dax && eur);
    assert.equal(btc.targetLevel, "63564.0977");
    assert.equal(btc.targetPeriod, "10 hours");
    assert.equal(btc.interval, "1 hour");
    assert.equal(btc.pattern, "Support");
    assert.equal(btc.identifiedAt, "17-Nov-06:00");
    assert.equal(dax.symbol, "DAX 40");
    assert.equal(dax.targetLevel, "25849.8333");
    assert.equal(dax.targetPeriod, "2 days");
    assert.equal(eur.pattern, "Falling Wedge");
    assert.equal(eur.interval, "30 Minutes");
  });

  test("joins wrapped reason and supporting lines", () => {
    const [btc, dax] = parseMarkets(EMAIL_TEXT);
    assert.ok(btc && dax);
    assert.equal(
      btc.reason,
      "Broke through Support level of 64251.6914 at 17-Nov-06:00"
    );
    assert.deepEqual(btc.supporting, [
      "Supported by Downward sloping Moving Average",
    ]);
    assert.equal(
      dax.reason,
      "Channel Up identified at 16-Nov-11:00. This pattern is still in the process of forming. Possible bearish price movement towards the support 25849.8333 within the next 2 days."
    );
  });

  test("reads support and resistance levels with their note", () => {
    const [btc, dax, eur] = parseMarkets(EMAIL_TEXT);
    assert.ok(btc && dax && eur);
    assert.equal(btc.levelType, "support");
    assert.equal(btc.levelValue, "64251.6914");
    assert.equal(dax.levelType, "resistance");
    assert.equal(dax.levelValue, "27011.0000");
    assert.equal(dax.levelNote, "Latest turning point of Channel Up");
    assert.equal(eur.levelValue, "1.1010");
  });

  test("accepts a heading split across lines", () => {
    const markets = parseMarkets("NASDAQ 100 |\nTarget Level\n26755.2413\nPattern\n: Falling Wedge");
    assert.equal(markets.length, 1);
    assert.equal(markets[0]?.symbol, "NASDAQ 100");
    assert.equal(markets[0]?.targetLevel, "26755.2413");
  });

  test("accepts a heading whose pipe was lost in the forward", () => {
    const markets = parseMarkets(
      "BTCUSD Target Level 63564.0977\nPattern\n: Support\nTrade Now"
    );
    assert.equal(markets.length, 1);
    assert.equal(markets[0]?.symbol, "BTCUSD");
    assert.equal(markets[0]?.targetLevel, "63564.0977");
  });

  test("accepts a heading split into symbol, label and value without a pipe", () => {
    const markets = parseMarkets(
      "BTCUSD\nTarget Level\n63564.0977\nPattern\n: Support\nTrade Now"
    );
    assert.equal(markets.length, 1);
    assert.equal(markets[0]?.symbol, "BTCUSD");
    assert.equal(markets[0]?.targetLevel, "63564.0977");
  });

  test("strips plain-text quote markers before matching a heading", () => {
    const markets = parseMarkets(
      "> BTCUSD | Target Level 63564.0977\n> Pattern\n> : Support\n> Trade Now"
    );
    assert.equal(markets.length, 1);
    assert.equal(markets[0]?.symbol, "BTCUSD");
  });

  test("reads the HTML body when the plain-text part is only a stub", () => {
    const session = parseSession({
      text: "FYI, see the analysis below.",
      html: [
        "<div>17-Nov-2026 06:14 EST</div>",
        "<div>BTCUSD | Target Level 63564.0977</div>",
        "<div>Pattern : Support</div>",
        "<div>Trade Now</div>",
      ].join(""),
      receivedAt: "2026-11-18T02:00:00.000Z",
    });
    assert.equal(session.sessionKey, "2026-11-17-session");
    assert.equal(session.sessionName, "Session");
    assert.equal(session.markets.length, 1);
    assert.equal(session.markets[0]?.symbol, "BTCUSD");
  });

  test("finds the analysis stamp and uses it as the session date", () => {
    const stamp = parseGeneratedAt(EMAIL_TEXT);
    assert.deepEqual(stamp, {
      date: "2026-11-17",
      label: "17-Nov-2026 06:14 EST",
    });

    const session = parseSession({
      subject: "AI Market Analysis (US Session)",
      from: "ai.analysis@getleveraged.com",
      receivedAt: "2026-11-18T02:00:00.000Z",
      text: EMAIL_TEXT,
    });
    assert.equal(session.sessionKey, "2026-11-17-us-session");
    assert.equal(session.sessionName, "US Session");
    assert.equal(session.generatedAt, "17-Nov-2026 06:14 EST");
    assert.equal(session.markets.length, 3);
  });

  test("falls back to the received date when there is no stamp", () => {
    const session = parseSession({
      receivedAt: "2026-11-18T02:00:00.000Z",
      text: "BTCUSD | Target Level 63564.0977\nPattern\n: Support",
    });
    assert.equal(session.sessionKey, "2026-11-18-session");
    assert.equal(session.sessionName, "Session");
    assert.equal(session.generatedAt, null);
  });
});

describe("session names", () => {
  test("reads the session label from the subject", () => {
    assert.equal(parseSessionName("Fwd: AI Market Analysis (US Session)"), "US Session");
    assert.equal(parseSessionName("AI Market Analysis (Asian Session)"), "Asian Session");
    assert.equal(parseSessionName("AI Market Analysis (European Session)"), "European Session");
    assert.equal(parseSessionName("AI Market Analysis - European Session"), "European Session");
    assert.equal(parseSessionName("AI Market Analysis"), "Session");
    assert.equal(parseSessionName(null), "Session");
  });

  test("normalizes known session labels", () => {
    assert.equal(normalizeSessionName("us session"), "US Session");
    assert.equal(normalizeSessionName("U.S. Session"), "US Session");
    assert.equal(normalizeSessionName("asian session"), "Asian Session");
    assert.equal(normalizeSessionName("european session"), "European Session");
    assert.equal(normalizeSessionName("  "), "Session");
  });

  test("keeps the three sessions on one date apart", () => {
    const text = "17-Nov-2026 06:14 EST\nBTCUSD | Target Level 63564.0977\nPattern : Support";
    const keys = ["Asian Session", "European Session", "US Session"].map((name) => {
      const session = parseSession({
        subject: `AI Market Analysis (${name})`,
        text,
      });
      assert.equal(session.sessionDate, "2026-11-17");
      assert.equal(session.sessionName, name);
      return session.sessionKey;
    });
    assert.deepEqual(keys, [
      "2026-11-17-asian-session",
      "2026-11-17-european-session",
      "2026-11-17-us-session",
    ]);
    assert.equal(new Set(keys).size, 3);
  });
});

describe("legacy session replacement", () => {
  const session = {
    sessionKey: "2026-11-17-us-session",
    sessionDate: "2026-11-17",
    sessionName: "US Session",
  };

  test("replaces a date-only document for the same session", () => {
    assert.equal(
      isLegacyDuplicate({ sessionKey: "2026-11-17", sessionName: "US Session" }, session),
      true
    );
    assert.equal(
      isLegacyDuplicate(
        { sessionKey: "2026-11-17", subject: "Fwd: AI Market Analysis (US Session)" },
        session
      ),
      true
    );
  });

  test("keeps a different session on the same date", () => {
    assert.equal(
      isLegacyDuplicate({ sessionKey: "2026-11-17", sessionName: "Asian Session" }, session),
      false
    );
  });

  test("ignores a key that is already session-aware", () => {
    assert.equal(isLegacyDuplicate({ sessionKey: "2026-11-17-us-session" }, session), false);
  });
});

function chart(width: number, height: number): ImageSize {
  return { width, height };
}

describe("session analysis images", () => {
  test("only portrait chart-sized images are charts", () => {
    assert.equal(isChartImage(chart(270, 370)), true);
    assert.equal(isChartImage(chart(155, 55)), false);
    assert.equal(isChartImage(chart(9, 9)), false);
    assert.equal(isChartImage(chart(800, 200)), false);
    assert.equal(isChartImage(null), false);
  });

  test("reads PNG dimensions from the header", () => {
    const buffer = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
    buffer.writeUInt32BE(270, 16);
    buffer.writeUInt32BE(370, 20);
    assert.deepEqual(imageSize(buffer), { width: 270, height: 370 });
  });

  test("pairs a labelled chart first and fills the rest in order", () => {
    const markets = [
      { symbol: "BTCUSD" },
      { symbol: "ETHUSD" },
    ] as ParsedMarket[];
    const image = (label: string | null): ParsedImage => ({
      buffer: Buffer.alloc(0),
      contentType: "image/png",
      width: 270,
      height: 370,
      label,
    });
    const first = image(null);
    const second = image("chart-ethusd.png");
    const paired = pairImages(markets, [first, second]);
    assert.equal(paired[0], first);
    assert.equal(paired[1], second);
  });
});

describe("IMAP setup rules", () => {
  test("accepts a complete implicit TLS setup", () => {
    const issues = validateImapSetup(
      {
        host: "imap.example.com",
        port: 993,
        encryption: "tls",
        username: "analysis@example.com",
        folder: "INBOX",
      },
      { passwordConfigured: true }
    );
    assert.deepEqual(issues.errors, []);
    assert.deepEqual(issues.warnings, []);
  });

  test("requires a password when a username is set", () => {
    const issues = validateImapSetup({
      host: "imap.example.com",
      username: "analysis@example.com",
    });
    assert.equal(issues.errors.length, 1);
    assert.match(issues.errors[0] ?? "", /password/i);
  });

  test("applies the documented defaults", () => {
    const values = asImapValues({
      host: "imap.example.com",
      username: "analysis@example.com",
      password: "secret",
    });
    assert.equal(values.port, 993);
    assert.equal(values.encryption, "tls");
    assert.equal(values.folder, "INBOX");
    assert.equal(values.senderFilter, "");
    assert.equal(values.subjectFilter, "");
    assert.equal(values.pollMinutes, 360);
    assert.equal(values.enabled, true);
  });
});

describe("Gmail preset", () => {
  test("fills the documented Gmail connection fields", () => {
    const preset = IMAP_PRESETS.find((entry) => entry.key === "gmail");
    assert.ok(preset);
    assert.equal(preset.values.host, "imap.gmail.com");
    assert.equal(preset.values.port, 993);
    assert.equal(preset.values.encryption, "tls");
    assert.equal(preset.values.folder, "INBOX");
    assert.equal(preset.values.pollMinutes, 360);
    assert.equal(preset.values.enabled, true);
    assert.equal("senderFilter" in preset.values, false);
    assert.equal("subjectFilter" in preset.values, false);
  });

  test("never ships the mailbox address or app password", () => {
    const preset = IMAP_PRESETS[0];
    assert.ok(preset);
    assert.equal("username" in preset.values, false);
    assert.equal("password" in preset.values, false);
  });

  test("passes cross-field validation once credentials are supplied", () => {
    const preset = IMAP_PRESETS[0];
    assert.ok(preset);
    const issues = validateImapSetup(
      { ...preset.values, username: "doochy@gmail.com" },
      { passwordConfigured: true }
    );
    assert.deepEqual(issues.errors, []);
    assert.deepEqual(issues.warnings, []);
  });
});

const FORWARDED_RAW = [
  "From: doochy@gmail.com",
  "To: doochy@gmail.com",
  "Subject: Fwd: AI Market Analysis",
  "Date: Tue, 17 Nov 2026 12:00:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="outer"',
  "",
  "--outer",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Forwarding the daily analysis.",
  "",
  "--outer",
  'Content-Type: message/rfc822; name="original.eml"',
  'Content-Disposition: attachment; filename="original.eml"',
  "",
  "From: AI Analysis <ai.analysis@getleveraged.com>",
  "To: someone@example.com",
  "Subject: AI Market Analysis",
  "Date: Tue, 17 Nov 2026 11:14:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "AI Market Analysis",
  "17-Nov-2026 06:14 EST",
  "",
  "BTCUSD | Target Level 63564.0977",
  "Pattern",
  ": Support",
  "",
  "--outer--",
  "",
].join("\r\n");

describe("forwarded analysis mail", () => {
  test("unwraps the embedded message and keeps the analysis", async () => {
    const parsed = await simpleParser(Buffer.from(FORWARDED_RAW));
    const chain = await forwardChain(parsed);
    assert.equal(chain.length, 2);
    const nested = chain[1];
    assert.ok(nested);
    assert.equal(nested.subject, "AI Market Analysis");
    assert.match(nested.from?.text ?? "", /ai\.analysis@getleveraged\.com/);

    const session = parseSession({
      subject: nested.subject,
      from: nested.from?.text,
      receivedAt: nested.date,
      text: nested.text,
    });
    assert.equal(session.sessionKey, "2026-11-17-session");
    assert.equal(session.markets.length, 1);
    assert.equal(session.markets[0]?.symbol, "BTCUSD");
  });

  test("matches the sender filter across the forward chain", async () => {
    const parsed = await simpleParser(Buffer.from(FORWARDED_RAW));
    const chain = await forwardChain(parsed);
    assert.equal(
      matchesFilters(chain, "ai.analysis@getleveraged.com", "AI Market Analysis"),
      true
    );
    assert.equal(matchesFilters(chain, "doochy@gmail.com", "AI Market Analysis"), true);
    assert.equal(
      matchesFilters(chain, "someone-else@example.com", "AI Market Analysis"),
      false
    );
    assert.equal(
      matchesFilters(chain, "ai.analysis@getleveraged.com", "Weekly Recap"),
      false
    );
  });
});

const INLINE_FORWARD_HTML = [
  "<html><body>",
  "<p>FYI</p>",
  "<div>---------- Forwarded message ---------<br>",
  "From: AI Analysis &lt;ai.analysis@getleveraged.com&gt;<br>",
  "Subject: AI Market Analysis (US Session)</div>",
  "<div>17-Nov-2026 06:14 EST</div>",
  "<div>BTCUSD | Target Level 63564.0977</div>",
  "<div>Pattern : Support</div>",
  "</body></html>",
].join("");

const INLINE_FORWARD_RAW = [
  "From: doochy@gmail.com",
  "To: doochy@gmail.com",
  "Subject: Fwd: AI Market Analysis (US Session)",
  "Date: Tue, 17 Nov 2026 12:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=utf-8",
  "",
  INLINE_FORWARD_HTML,
].join("\r\n");

describe("inline forwarded analysis mail", () => {
  test("matches the original sender from the quoted body", async () => {
    const parsed = await simpleParser(Buffer.from(INLINE_FORWARD_RAW));
    const chain = await forwardChain(parsed);
    assert.equal(chain.length, 1);
    assert.equal(
      matchesFilters(chain, "ai.analysis@getleveraged.com", "AI Market Analysis"),
      true
    );
  });

  test("parses the market card from the forwarded body", async () => {
    const parsed = await simpleParser(Buffer.from(INLINE_FORWARD_RAW));
    const session = parseSession({
      subject: parsed.subject,
      from: parsed.from?.text,
      receivedAt: parsed.date,
      html: typeof parsed.html === "string" ? parsed.html : null,
      text: parsed.text,
    });
    assert.equal(session.sessionKey, "2026-11-17-us-session");
    assert.equal(session.sessionName, "US Session");
    assert.equal(session.markets.length, 1);
    assert.equal(session.markets[0]?.symbol, "BTCUSD");
    assert.equal(session.markets[0]?.pattern, "Support");
  });

  test("empty filters accept every message", async () => {
    const parsed = await simpleParser(Buffer.from(INLINE_FORWARD_RAW));
    const chain = await forwardChain(parsed);
    assert.equal(matchesFilters(chain, "", ""), true);
  });
});

describe("stored chart bytes", () => {
  test("returns a Node Buffer unchanged", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    assert.equal(storedBuffer(bytes), bytes);
  });

  test("unwraps a BSON Binary from a lean read", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const binary = {
      _bsontype: "Binary",
      buffer: Buffer.concat([png, Buffer.from([0xff, 0xff])]),
      position: png.length,
      sub_type: 0,
    };
    assert.deepEqual(storedBuffer(binary), png);
  });

  test("unwraps a JSON-serialized buffer", () => {
    assert.deepEqual(
      storedBuffer({ type: "Buffer", data: [1, 2, 3] }),
      Buffer.from([1, 2, 3])
    );
  });

  test("returns null when the stored value is missing or empty", () => {
    assert.equal(storedBuffer(null), null);
    assert.equal(storedBuffer(undefined), null);
    assert.equal(storedBuffer({}), null);
  });

  test("serves real bytes for a lean BSON Binary image document", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const original = SessionAnalysisImageModel.findById.bind(SessionAnalysisImageModel);
    (SessionAnalysisImageModel as unknown as { findById: unknown }).findById = () => ({
      lean: () => ({
        exec: async () => ({
          contentType: "image/png",
          data: { _bsontype: "Binary", buffer: png, position: png.length },
        }),
      }),
    });
    try {
      const image = await imageById("6afcbf7a5620d38a477f382f");
      assert.ok(image);
      assert.equal(image.contentType, "image/png");
      assert.deepEqual(image.data, png);
    } finally {
      (SessionAnalysisImageModel as unknown as { findById: unknown }).findById = original;
    }
  });
});
