import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { brandInitials, monogramDataUrl } from "../src/webapp/src/brandMark";

describe("brand mark", () => {
  test("uses one initial for a single word and two for a multi-word brand", () => {
    assert.equal(brandInitials("Acme"), "A");
    assert.equal(brandInitials("Acme Trading"), "AT");
    assert.equal(brandInitials("  north   star  "), "NS");
    assert.equal(brandInitials(""), "?");
  });

  test("builds an encoded SVG monogram with the brand colours", () => {
    const url = monogramDataUrl("Acme Trading", "#123456", "#ffffff", 80);
    assert.match(url, /^data:image\/svg\+xml,/);
    const svg = decodeURIComponent(url.slice("data:image/svg+xml,".length));
    assert.match(svg, /width="80" height="80"/);
    assert.match(svg, /fill="#123456"/);
    assert.match(svg, /fill="#ffffff"/);
    assert.match(svg, />AT<\/text>/);
  });

  test("escapes initials before they reach the SVG", () => {
    const svg = decodeURIComponent(
      monogramDataUrl("<script>", "#000000", "#ffffff").slice("data:image/svg+xml,".length)
    );
    assert.equal(svg.includes("<script>"), false);
    assert.match(svg, /&lt;/);
  });
});
