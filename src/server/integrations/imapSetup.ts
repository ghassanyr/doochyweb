// Cross-field IMAP rules shared by the admin state, the draft test endpoint and
// the session analysis poller.
//
// The connection test only proves that the host accepts the credentials and the
// configured folder can be opened. It does not import anything.

import { ImapFlow } from "imapflow";

import type { SetupIssues } from "./ctraderSetup";
import type { IntegrationFieldState, IntegrationTestResult } from "./types";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export interface ImapValues {
  host: string;
  port: number;
  encryption: "tls" | "starttls" | "none";
  username: string;
  password: string;
  folder: string;
  senderFilter: string;
  subjectFilter: string;
  pollMinutes: number;
  enabled: boolean;
}

export interface ImapPreset {
  key: string;
  label: string;
  hint: string;
  values: Record<string, string | number | boolean>;
}

/**
 * Gmail is the documented default for the dedicated analysis mailbox. Gmail
 * refuses the normal account password over IMAP, so the admin has to create an
 * App Password after turning on 2-Step Verification. The preset deliberately
 * leaves the username and password alone: the username is the mailbox address
 * and the password is a secret that must never be shipped in source.
 */
export const IMAP_PRESETS: readonly ImapPreset[] = [
  {
    key: "gmail",
    label: "Gmail",
    hint:
      "imap.gmail.com on port 993. Gmail needs 2-Step Verification and an App Password. " +
      "The username is the full mailbox address.",
    values: {
      host: "imap.gmail.com",
      port: 993,
      encryption: "tls",
      folder: "INBOX",
      senderFilter: "ai.analysis@getleveraged.com",
      subjectFilter: "AI Market Analysis",
      pollMinutes: 360,
      enabled: true,
    },
  },
];

export function validateImapSetup(
  values: Record<string, unknown>,
  options: { passwordConfigured?: boolean } = {}
): SetupIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const encryption = text(values.encryption) || "tls";
  const port = Number(values.port ?? 993);
  const username = text(values.username);
  const password = text(values.password);
  const folder = text(values.folder) || "INBOX";

  if (encryption === "none") {
    warnings.push(
      "IMAP encryption is off. Use this only for a local relay or a trusted private network."
    );
  }
  if (encryption === "tls" && port !== 993) {
    warnings.push("Implicit TLS usually uses port 993.");
  }
  if (encryption === "starttls" && port === 143) {
    // Expected pairing; no warning.
  } else if (encryption === "starttls" && port === 993) {
    warnings.push("Port 993 normally uses implicit TLS, not STARTTLS.");
  }
  if (!username && (password || options.passwordConfigured)) {
    errors.push("IMAP username is required when a password is set.");
  }
  if (username && !password && !options.passwordConfigured) {
    errors.push("IMAP password is required when a username is set.");
  }
  if (folder.includes("/") && folder.startsWith("/")) {
    warnings.push("Folder names normally do not start with a slash.");
  }
  return { errors, warnings };
}

export function providerImapIssues(fields: IntegrationFieldState[]): SetupIssues {
  const values: Record<string, unknown> = {};
  let passwordConfigured = false;
  for (const field of fields) {
    if (field.kind !== "secret" && field.value !== null) values[field.key] = field.value;
    if (field.key === "password" && field.kind === "secret") {
      passwordConfigured = field.configured && field.error === null;
    }
  }
  return validateImapSetup(values, { passwordConfigured });
}

export function asImapValues(values: Record<string, unknown>): ImapValues {
  const encryption = text(values.encryption);
  return {
    host: text(values.host),
    port: Number(values.port ?? 993),
    encryption:
      encryption === "starttls" || encryption === "none" ? encryption : "tls",
    username: text(values.username),
    password: text(values.password),
    folder: text(values.folder) || "INBOX",
    senderFilter: text(values.senderFilter),
    subjectFilter: text(values.subjectFilter),
    pollMinutes: Number(values.pollMinutes ?? 360),
    enabled: values.enabled !== false,
  };
}

/** Create a client without starting the connection. */
export function imapClient(values: ImapValues): ImapFlow {
  return new ImapFlow({
    host: values.host,
    port: values.port,
    secure: values.encryption === "tls",
    doSTARTTLS: values.encryption === "starttls",
    auth: { user: values.username, pass: values.password },
    logger: false,
    disableAutoIdle: true,
  });
}

export async function testImapConnection(
  values: ImapValues
): Promise<IntegrationTestResult> {
  if (!values.host) return { ok: false, message: "An IMAP host is required." };
  if (!values.username) return { ok: false, message: "An IMAP username is required." };
  if (!values.password) return { ok: false, message: "An IMAP password is required." };

  const client = imapClient(values);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(values.folder);
    try {
      const mailbox = client.mailbox;
      const count = mailbox && typeof mailbox === "object" ? mailbox.exists : 0;
      return {
        ok: true,
        message: `Connected to ${values.host} and opened ${values.folder} (${count} message${count === 1 ? "" : "s"}).`,
      };
    } finally {
      lock.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "connection failed";
    return { ok: false, message: `Could not read the mailbox: ${message}` };
  } finally {
    await client.logout().catch(() => undefined);
  }
}
