import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { legalAcceptanceRequired, legalAcceptanceSatisfied } from "../src/server/legal";

const none = { termsUrl: "", privacyUrl: "" };
const terms = { termsUrl: "https://example.test/terms", privacyUrl: "" };
const privacy = { termsUrl: "", privacyUrl: "https://example.test/privacy" };
const both = {
  termsUrl: "https://example.test/terms",
  privacyUrl: "https://example.test/privacy",
};

describe("legal acceptance", () => {
  test("does not require acceptance when no legal links are configured", () => {
    assert.equal(legalAcceptanceRequired(none), false);
    assert.equal(legalAcceptanceSatisfied(none, undefined), true);
    assert.equal(legalAcceptanceSatisfied(none, false), true);
  });

  test("requires acceptance for either configured link", () => {
    assert.equal(legalAcceptanceRequired(terms), true);
    assert.equal(legalAcceptanceRequired(privacy), true);
    assert.equal(legalAcceptanceRequired(both), true);
  });

  test("only accepts the boolean true", () => {
    assert.equal(legalAcceptanceSatisfied(both, true), true);
    assert.equal(legalAcceptanceSatisfied(both, false), false);
    assert.equal(legalAcceptanceSatisfied(both, "true"), false);
    assert.equal(legalAcceptanceSatisfied(both, undefined), false);
  });
});
