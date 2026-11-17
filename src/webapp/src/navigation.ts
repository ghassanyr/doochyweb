// Grouping and access rules for the primary sidebar and the mobile tab bar.
//
// Admin, Site settings controls each group's label and order, and each
// module's label, visibility, access and order. This file only decides which
// modules are visible and keeps the configured order inside each group, so the
// shell stays predictable without adding rendering rules of its own.
//
// The Admin destination is not a module, so it is rendered separately by the
// sidebar and is not part of these groups.

import type { ModuleSettings, NavGroupSettings } from "./api";

export interface NavGroup extends NavGroupSettings {
  modules: ModuleSettings[];
}

/**
 * Split the configured modules into sidebar sections.
 *
 * Hidden modules are dropped. Admin-only modules are dropped for everyone else.
 * Signed-in modules stay visible for signed-out visitors so the sidebar can show
 * them with a lock, which is how the value of an account stays discoverable.
 */
export function groupModules(
  modules: ModuleSettings[],
  groups: NavGroupSettings[],
  opts: { signedIn: boolean; isAdmin: boolean }
): NavGroup[] {
  const visible = modules.filter((module) => {
    if (module.hidden) return false;
    if (module.access === "admin" && !opts.isAdmin) return false;
    return true;
  });
  const keys = new Set(groups.map((group) => group.key));
  const firstKey = groups[0]?.key;
  // A module whose stored group was removed still needs a home.
  const groupKeyFor = (module: ModuleSettings) =>
    keys.has(module.group) ? module.group : firstKey;

  return groups
    .map((group) => ({
      key: group.key,
      label: group.label,
      modules: visible.filter((module) => groupKeyFor(module) === group.key),
    }))
    .filter((group) => group.modules.length > 0);
}

/**
 * The modules shown as quick destinations in the mobile bottom bar. They follow
 * the configured sidebar order so the bar and the drawer never disagree.
 */
export function quickModules(
  modules: ModuleSettings[],
  groups: NavGroupSettings[],
  opts: { signedIn: boolean; isAdmin: boolean },
  limit = 3
): ModuleSettings[] {
  return groupModules(modules, groups, opts)
    .flatMap((group) => group.modules)
    .slice(0, Math.max(0, limit));
}

/** True when the destination needs a session the visitor does not have. */
export function isModuleLocked(
  module: Pick<ModuleSettings, "access">,
  signedIn: boolean
): boolean {
  return module.access === "signed-in" && !signedIn;
}
