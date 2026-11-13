import type { RegistrationSettings } from "./settings/types";

export type RegistrationDecision =
  | { allowed: true; status: "active" | "pending" }
  | { allowed: false; error: string };

/** Apply the public registration policy without touching the database. */
export function registrationDecision(
  registration: RegistrationSettings,
  suppliedInviteCode: unknown
): RegistrationDecision {
  if (registration.mode === "closed") {
    return {
      allowed: false,
      error: registration.message || "Registration is closed.",
    };
  }
  if (registration.mode === "invite") {
    const supplied =
      typeof suppliedInviteCode === "string" ? suppliedInviteCode.trim() : "";
    if (!registration.inviteCode || supplied !== registration.inviteCode) {
      return { allowed: false, error: "That invite code is not valid." };
    }
  }
  return {
    allowed: true,
    status: registration.mode === "approval" ? "pending" : "active",
  };
}
