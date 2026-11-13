// Cross-field SMTP rules shared by the admin state and the draft test endpoint.

import type { SetupIssues } from "./ctraderSetup";
import type { IntegrationFieldState } from "./types";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateSmtpSetup(values: Record<string, unknown>): SetupIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const encryption = text(values.encryption) || "starttls";
  const username = text(values.username);
  const password = text(values.password);
  const port = Number(values.port ?? 587);

  if (encryption === "none") {
    warnings.push(
      "SMTP encryption is off. Use this only for a local relay or a trusted private network."
    );
  }
  if (encryption === "tls" && port !== 465) {
    warnings.push("Implicit TLS usually uses port 465.");
  }
  if (encryption === "starttls" && port === 465) {
    warnings.push("Port 465 normally uses implicit TLS, not STARTTLS.");
  }
  if (username && !password) {
    errors.push("SMTP password is required when a username is set.");
  }
  if (!username && password) {
    warnings.push("An SMTP password was supplied without a username; it will be ignored.");
  }

  return { errors, warnings };
}

export function providerSmtpIssues(fields: IntegrationFieldState[]): SetupIssues {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.kind !== "secret" && field.value !== null) values[field.key] = field.value;
  }
  return validateSmtpSetup(values);
}
