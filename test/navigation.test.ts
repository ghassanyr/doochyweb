import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ModuleSettings, NavGroupSettings } from "../src/webapp/src/api";
import { groupModules, isModuleLocked, quickModules } from "../src/webapp/src/navigation";

const groups: NavGroupSettings[] = [
  { key: "market", label: "Market" },
  { key: "workspace", label: "Workspace" },
  { key: "learn", label: "Learn" },
];

const modules: ModuleSettings[] = [
  { key: "analysis", label: "Analysis", hidden: false, access: "public", group: "market" },
  { key: "signals", label: "Signals", hidden: false, access: "public", group: "market" },
  { key: "breakouts", label: "Breakouts", hidden: false, access: "public", group: "market" },
  { key: "learn", label: "Learn", hidden: false, access: "public", group: "learn" },
  { key: "trading", label: "Trading", hidden: false, access: "signed-in", group: "workspace" },
  { key: "alerts", label: "Alerts", hidden: false, access: "signed-in", group: "workspace" },
  { key: "briefing", label: "Briefing", hidden: false, access: "signed-in", group: "workspace" },
  { key: "coach", label: "Coach", hidden: false, access: "signed-in", group: "workspace" },
];

describe("sidebar navigation", () => {
  test("groups modules in the configured order", () => {
    const result = groupModules(modules, groups, { signedIn: true, isAdmin: false });
    assert.deepEqual(
      result.map((group) => group.key),
      ["market", "workspace", "learn"]
    );
    assert.deepEqual(
      result[0].modules.map((module) => module.key),
      ["analysis", "signals", "breakouts"]
    );
    assert.deepEqual(
      result[1].modules.map((module) => module.key),
      ["trading", "alerts", "briefing", "coach"]
    );
    assert.deepEqual(
      result[2].modules.map((module) => module.key),
      ["learn"]
    );
  });

  test("keeps the configured order inside a group", () => {
    const reordered = [modules[1], modules[0], modules[2], ...modules.slice(3)];
    const result = groupModules(reordered, groups, { signedIn: true, isAdmin: false });
    assert.deepEqual(
      result[0].modules.map((module) => module.key),
      ["signals", "analysis", "breakouts"]
    );
  });

  test("honours configured group labels and order", () => {
    const custom: NavGroupSettings[] = [
      { key: "workspace", label: "Desk" },
      { key: "market", label: "Research" },
      { key: "learn", label: "Study" },
    ];
    const result = groupModules(modules, custom, { signedIn: true, isAdmin: false });
    assert.deepEqual(
      result.map((group) => group.label),
      ["Desk", "Research", "Study"]
    );
    assert.deepEqual(
      result[0].modules.map((module) => module.key),
      ["trading", "alerts", "briefing", "coach"]
    );
  });

  test("drops hidden modules and empty groups", () => {
    const hidden = modules.map((module) =>
      module.key === "learn" ? { ...module, hidden: true } : module
    );
    const result = groupModules(hidden, groups, { signedIn: true, isAdmin: false });
    assert.deepEqual(
      result.map((group) => group.key),
      ["market", "workspace"]
    );
  });

  test("hides admin-only modules from non-admins", () => {
    const adminOnly = modules.map((module) =>
      module.key === "learn" ? { ...module, access: "admin" as const } : module
    );
    const publicGroups = groupModules(adminOnly, groups, { signedIn: false, isAdmin: false });
    assert.equal(
      publicGroups.some((group) => group.modules.some((module) => module.key === "learn")),
      false
    );
    const adminGroups = groupModules(adminOnly, groups, { signedIn: true, isAdmin: true });
    assert.equal(
      adminGroups.some((group) => group.modules.some((module) => module.key === "learn")),
      true
    );
  });

  test("keeps signed-in modules visible so they can show a lock", () => {
    const result = groupModules(modules, groups, { signedIn: false, isAdmin: false });
    assert.equal(
      result.some((group) => group.modules.some((module) => module.key === "trading")),
      true
    );
  });

  test("a module with a removed group falls into the first section", () => {
    const orphaned = modules.map((module) =>
      module.key === "analysis" ? { ...module, group: "deleted" } : module
    );
    const result = groupModules(orphaned, groups, { signedIn: true, isAdmin: false });
    assert.equal(result[0].key, "market");
    assert.equal(
      result[0].modules.some((module) => module.key === "analysis"),
      true
    );
  });

  test("quick destinations follow the sidebar order and stop at three", () => {
    const quick = quickModules(modules, groups, { signedIn: true, isAdmin: false });
    assert.deepEqual(
      quick.map((module) => module.key),
      ["analysis", "signals", "breakouts"]
    );
    assert.equal(
      quickModules(modules, groups, { signedIn: true, isAdmin: false }, 2).length,
      2
    );
  });

  test("locks only signed-in destinations", () => {
    assert.equal(isModuleLocked({ access: "signed-in" }, false), true);
    assert.equal(isModuleLocked({ access: "signed-in" }, true), false);
    assert.equal(isModuleLocked({ access: "public" }, false), false);
    assert.equal(isModuleLocked({ access: "admin" }, false), false);
  });
});
