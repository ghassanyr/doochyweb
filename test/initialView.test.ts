import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { initialView } from "../src/webapp/src/initialView";

describe("initialView", () => {
  test("opens Learn from the view query", () => {
    assert.equal(initialView("?view=learn", "doochy.net"), "learn");
    assert.equal(initialView("view=learn", "doochy.net"), "learn");
  });

  test("opens Signals from the view query", () => {
    assert.equal(initialView("?view=signals", "doochy.net"), "signals");
    assert.equal(initialView("?view=signals&signal=abc", "doochy.net"), "signals");
  });

  test("opens Learn from the learn host and its subdomains", () => {
    assert.equal(initialView("", "learn.doochy.net"), "learn");
    assert.equal(initialView("", "learn.example.com"), "learn");
    assert.equal(initialView("", "LEARN.DOOCHY.NET"), "learn");
  });

  test("keeps shared note links on Breakouts", () => {
    assert.equal(initialView("?note=abc", "doochy.net"), "breakouts");
    assert.equal(initialView("?note=abc&view=learn", "doochy.net"), "learn");
  });

  test("defaults to Analysis elsewhere", () => {
    assert.equal(initialView("", "doochy.net"), "analysis");
    assert.equal(initialView("?view=analysis", "doochy.net"), "analysis");
    assert.equal(initialView("", "notlearn.doochy.net"), "analysis");
  });
});
