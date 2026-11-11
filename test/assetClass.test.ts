import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ASSET_FILTERS, assetClass } from "../src/webapp/src/market/assetClass";

describe("assetClass", () => {
  test("maps the server's symbol types onto the four analysis filters", () => {
    assert.equal(assetClass("crypto"), "crypto");
    assert.equal(assetClass("forex"), "forex");
    assert.equal(assetClass("commodity"), "metals");
    assert.equal(assetClass("index"), "indices");
  });

  test("leaves types outside the four filters unbucketed", () => {
    assert.equal(assetClass("stock"), null);
    assert.equal(assetClass("unknown"), null);
    assert.equal(assetClass(undefined), null);
  });

  test("offers All first, then the four asset classes", () => {
    assert.deepEqual(
      ASSET_FILTERS.map((f) => f.id),
      ["all", "crypto", "forex", "metals", "indices"]
    );
  });
});
