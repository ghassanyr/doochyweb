import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pathForView, resolveRoute, viewFromPath } from "../src/webapp/src/routing";

const D = "doochy.net";

describe("path routing", () => {
  test("maps canonical paths to views", () => {
    assert.equal(pathForView("home"), "/");
    assert.equal(viewFromPath("/"), "home");
    for (const view of ["analysis", "signals", "breakouts", "learn", "trading", "admin"] as const) {
      assert.equal(pathForView(view), `/${view}`);
      assert.equal(viewFromPath(`/${view}`), view);
      assert.deepEqual(resolveRoute({ pathname: `/${view}`, search: "", hostname: D }), {
        view,
        redirectTo: null,
      });
    }
  });

  test("renders Home at the root", () => {
    assert.deepEqual(resolveRoute({ pathname: "/", search: "", hostname: D }), {
      view: "home",
      redirectTo: null,
    });
    assert.deepEqual(resolveRoute({ pathname: "/home", search: "", hostname: D }), {
      view: "home",
      redirectTo: "/",
    });
  });

  test("canonicalizes trailing slashes and legacy view params", () => {
    assert.deepEqual(resolveRoute({ pathname: "/signals/", search: "?signal=abc", hostname: D }), {
      view: "signals",
      redirectTo: "/signals?signal=abc",
    });
    assert.deepEqual(resolveRoute({ pathname: "/signals", search: "?view=learn", hostname: D }), {
      view: "signals",
      redirectTo: "/signals",
    });
  });

  test("redirects legacy query links to paths", () => {
    assert.deepEqual(resolveRoute({ pathname: "/", search: "?view=learn", hostname: D }), {
      view: "learn",
      redirectTo: "/learn",
    });
    assert.deepEqual(
      resolveRoute({ pathname: "/", search: "?view=trading&ctrader=connected", hostname: D }),
      { view: "trading", redirectTo: "/trading?ctrader=connected" }
    );
    assert.deepEqual(
      resolveRoute({ pathname: "/", search: "?view=signals&signal=abc", hostname: D }),
      { view: "signals", redirectTo: "/signals?signal=abc" }
    );
    assert.deepEqual(resolveRoute({ pathname: "/", search: "?view=home", hostname: D }), {
      view: "home",
      redirectTo: "/",
    });
    assert.deepEqual(resolveRoute({ pathname: "/", search: "?view=bogus", hostname: D }), {
      view: "home",
      redirectTo: "/",
    });
  });

  test("keeps shared note links on Breakouts", () => {
    assert.deepEqual(resolveRoute({ pathname: "/", search: "?note=abc", hostname: D }), {
      view: "breakouts",
      redirectTo: "/breakouts?note=abc",
    });
    assert.deepEqual(
      resolveRoute({ pathname: "/", search: "?note=abc&view=learn", hostname: D }),
      { view: "learn", redirectTo: "/learn?note=abc" }
    );
  });

  test("falls back from the learn host and unknown paths", () => {
    assert.deepEqual(resolveRoute({ pathname: "/", search: "", hostname: "learn.doochy.net" }), {
      view: "learn",
      redirectTo: "/learn",
    });
    assert.deepEqual(resolveRoute({ pathname: "/not-a-view", search: "", hostname: D }), {
      view: "analysis",
      redirectTo: "/analysis",
    });
    assert.deepEqual(resolveRoute({ pathname: "/not-a-view", search: "?note=abc", hostname: D }), {
      view: "breakouts",
      redirectTo: "/breakouts?note=abc",
    });
  });

  test("keeps clean canonical URLs unchanged", () => {
    assert.deepEqual(resolveRoute({ pathname: "/breakouts", search: "?note=abc", hostname: D }), {
      view: "breakouts",
      redirectTo: null,
    });
  });
});
