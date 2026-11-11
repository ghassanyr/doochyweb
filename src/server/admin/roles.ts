// Admin role helpers. The role lives on the user document and is read on every
// admin request, so these changes take effect without re-issuing JWTs.

import { User, type UserRole } from "../db";

export type RoleChange =
  | "promoted"
  | "already_admin"
  | "demoted"
  | "not_admin"
  | "last_admin"
  | "missing";

/** Usernames named by ADMIN_USERNAME, comma-separated. */
export function configuredAdminUsernames(): string[] {
  return String(process.env.ADMIN_USERNAME ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Promote the users named in ADMIN_USERNAME. Idempotent, so it can run on every
 * boot and acts as the bootstrap path for an existing user base.
 */
export async function promoteConfiguredAdmins(): Promise<void> {
  for (const username of configuredAdminUsernames()) {
    const result = await setRole(username, "admin");
    if (result === "missing") {
      console.warn(`[ADMIN] ADMIN_USERNAME "${username}" does not match any user`);
    } else if (result === "promoted") {
      console.log(`[ADMIN] Promoted "${username}" to admin`);
    }
  }
}

/**
 * Set a user's role by username. Refuses to demote the last admin, so a
 * deployment can never lock itself out of the panel.
 */
export async function setRole(username: string, role: UserRole): Promise<RoleChange> {
  const user = await User.findOne({ username }).lean().exec();
  if (!user) return "missing";

  const current = ((user.role as UserRole | undefined) ?? "user");
  if (current === role) return role === "admin" ? "already_admin" : "not_admin";

  if (role === "user" && current === "admin") {
    const admins = await User.countDocuments({ role: "admin" }).exec();
    if (admins <= 1) return "last_admin";
  }

  await User.updateOne({ _id: user._id }, { $set: { role } }).exec();
  return role === "admin" ? "promoted" : "demoted";
}
