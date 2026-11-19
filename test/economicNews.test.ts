import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { simpleParser } from "mailparser";

import { isEconomicNewsSubject, parseEconomicNews } from "../src/server/economicNews/parse";
import { saveEconomicNews } from "../src/server/economicNews/store";
import { asImapValues } from "../src/server/integrations/imapSetup";
import { integrationField } from "../src/server/integrations/registry";
import { classifyInboxChain } from "../src/server/sessionAnalysis/ingest";

const NEWS_TEXT = `High Impact Economic News
18-Nov-2026 15:03 UTC
The High Impact Financial News Events listed below are scheduled to take place over the next 8 hours.
Add event to your Calendar
US 0 18-Nov-2026 19:00 UTC FOMC Minutes
GB 0 18-Nov-2026 21:30 UTC GDP (QoQ)
Disclaimer: not financial advice.`;

const NEWS_HTML = `<div>High Impact Economic News</div><div>18-Nov-2026 15:03 UTC</div>
<table>
  <tr><td>US</td><td>0</td><td>18-Nov-2026 19:00 UTC</td><td>FOMC Minutes</td></tr>
  <tr><td>JP</td><td>0</td><td>19-Nov-2026 02:00 UTC</td><td>BOJ Statement</td></tr>
</table>`;

function rawMail(subject: string, from = "news@example.com") {
  return [
    `From: ${from}`,
    `To: inbox@example.com`,
    `Subject: ${subject}`,
    `Date: Wed, 18 Nov 2026 15:03:00 +0000`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    NEWS_TEXT,
  ].join("\r\n");
}

describe("economic news parsing", () => {
  test("parses the sample email and ignores the extra numeric column", () => {
    const parsed = parseEconomicNews({ subject: "High Impact Economic News", text: NEWS_TEXT });
    assert.equal(parsed.generatedAt, "2026-11-18T15:03:00.000Z");
    assert.equal(parsed.events.length, 2);
    assert.equal(parsed.events[0]?.country, "US");
    assert.equal(parsed.events[0]?.startsAt, "2026-11-18T19:00:00.000Z");
    assert.equal(parsed.events[0]?.title, "FOMC Minutes");
    assert.equal(parsed.events[1]?.country, "GB");
    assert.equal(parsed.events[1]?.startsAt, "2026-11-18T21:30:00.000Z");
    assert.equal(parsed.events[1]?.title, "GDP (QoQ)");
    assert.match(parsed.events[0]?.eventKey ?? "", /^[a-f0-9]{24}$/);
  });

  test("parses events from HTML table rows", () => {
    const parsed = parseEconomicNews({ subject: "High Impact Economic News", html: NEWS_HTML });
    assert.equal(parsed.events.length, 2);
    assert.equal(parsed.events[0]?.title, "FOMC Minutes");
    assert.equal(parsed.events[1]?.country, "JP");
    assert.equal(parsed.events[1]?.title, "BOJ Statement");
  });

  test("returns no events for unrelated text", () => {
    const parsed = parseEconomicNews({
      subject: "AI Market Analysis (US Session)",
      text: "BTCUSD | Target Level 100000\nPattern: Support",
    });
    assert.equal(parsed.events.length, 0);
  });

  test("recognizes the configured news subject only", () => {
    assert.equal(
      isEconomicNewsSubject("High Impact Economic News", "High Impact Economic News"),
      true
    );
    assert.equal(
      isEconomicNewsSubject("AI Market Analysis (US Session)", "High Impact Economic News"),
      false
    );
    assert.equal(isEconomicNewsSubject("High Impact Economic News", ""), false);
  });
});

describe("shared inbox classification", () => {
  const values = {
    senderFilter: "",
    subjectFilter: "AI Market Analysis",
    newsSubjectFilter: "High Impact Economic News",
  };

  test("classifies market analysis and news from the same mailbox", async () => {
    const session = await simpleParser(Buffer.from(rawMail("AI Market Analysis (US Session)")));
    const news = await simpleParser(Buffer.from(rawMail("High Impact Economic News")));
    assert.deepEqual(classifyInboxChain([session], values), { news: false, session: true });
    assert.deepEqual(classifyInboxChain([news], values), { news: true, session: false });
  });

  test("rejects other subjects and sender mismatches", async () => {
    const other = await simpleParser(Buffer.from(rawMail("Weekly newsletter")));
    assert.deepEqual(classifyInboxChain([other], values), { news: false, session: false });
    const news = await simpleParser(Buffer.from(rawMail("High Impact Economic News")));
    assert.deepEqual(
      classifyInboxChain([news], { ...values, senderFilter: "someone-else@example.com" }),
      { news: false, session: false }
    );
  });

  test("keeps the news filter inside the existing IMAP integration", () => {
    const field = integrationField("imap", "newsSubjectFilter");
    assert.ok(field);
    assert.equal(field.defaultValue, "High Impact Economic News");
    assert.equal(
      asImapValues({ newsSubjectFilter: "High Impact Economic News" }).newsSubjectFilter,
      "High Impact Economic News"
    );
  });

  test("does not touch the store for an empty event list", async () => {
    assert.equal(
      await saveEconomicNews([], {
        subject: "High Impact Economic News",
        generatedAt: null,
        receivedAt: null,
      }),
      0
    );
  });
});
