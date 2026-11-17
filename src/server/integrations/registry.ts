// Provider registry for the Integrations admin section.
//
// Field order drives the admin form, `env` supplies the bootstrap fallback so a
// fresh self-hosted deployment keeps working with its existing .env, and
// `kind: "secret"` decides what is encrypted at rest. Adding SMTP later is just
// another entry here plus a runtime consumer.

import type {
  IntegrationFieldDef,
  IntegrationProvider,
  IntegrationProviderDef,
} from "./types";

export const INTEGRATION_PROVIDERS: readonly IntegrationProvider[] = [
  "ctrader",
  "mt5",
  "telegram",
  "smtp",
  "ai",
  "imap",
];

export const INTEGRATION_DEFS: Record<IntegrationProvider, IntegrationProviderDef> = {
  ctrader: {
    provider: "ctrader",
    label: "cTrader",
    description:
      "The Open API app every user connects through. Register it at openapi.ctrader.com/apps and add the callback URL shown below; the callback is derived from your site address.",
    fields: [
      {
        key: "clientId",
        label: "Client ID",
        kind: "text",
        env: "CTRADER_CLIENT_ID",
        required: true,
        maxLength: 200,
        hint: "From openapi.ctrader.com/apps → your app → Credentials.",
      },
      {
        key: "clientSecret",
        label: "Client secret",
        kind: "secret",
        env: "CTRADER_CLIENT_SECRET",
        required: true,
        maxLength: 500,
        hint: "Encrypted at rest. cTrader can show it again from the app's Credentials page.",
      },
      {
        key: "scope",
        label: "Scope",
        kind: "select",
        env: "CTRADER_OAUTH_SCOPE",
        defaultValue: "trading",
        options: [
          { value: "trading", label: "Trading (accounts, positions and orders)" },
          { value: "accounts", label: "Accounts (view-only)" },
        ],
        hint: "trading is required for positions and orders; accounts is view-only.",
      },
      {
        key: "allowManual",
        label: "Allow user-owned cTrader apps",
        kind: "boolean",
        env: "CTRADER_ALLOW_MANUAL",
        defaultValue: false,
        hint: "Off by default. Keep it off unless users must register their own Open API app and paste tokens instead of using cTrader sign-in.",
      },
    ],
  },
  mt5: {
    provider: "mt5",
    label: "MetaTrader 5",
    description:
      "Read-only MT5 market data from a self-hosted bridge. Keep the bridge on the same private network as the terminal; no MT5 credentials are sent to the browser.",
    fields: [
      {
        key: "bridgeUrl",
        label: "Bridge URL",
        kind: "text",
        env: "MT5_BRIDGE_URL",
        required: true,
        format: "url",
        maxLength: 300,
        placeholder: "http://127.0.0.1:8000",
        hint: "Base URL of the bridge service that talks to the MT5 terminal.",
      },
      {
        key: "apiKey",
        label: "Bridge API key",
        kind: "secret",
        env: "MT5_BRIDGE_API_KEY",
        maxLength: 500,
        hint: "Optional shared secret sent as a bearer token. Encrypted at rest and never returned to the browser.",
      },
      {
        key: "accountId",
        label: "Bridge account ID",
        kind: "text",
        env: "MT5_ACCOUNT_ID",
        required: true,
        maxLength: 120,
        placeholder: "market-demo",
        hint: "Identifies the MT5 account profile configured in the bridge.",
      },
      {
        key: "mode",
        label: "Account mode",
        kind: "select",
        env: "MT5_MODE",
        defaultValue: "demo",
        options: [
          { value: "demo", label: "Demo" },
          { value: "live", label: "Live" },
        ],
        hint: "Demo is recommended for the public read-only analysis page.",
      },
      {
        key: "enabled",
        label: "Use MT5 for market analysis",
        kind: "boolean",
        env: "MT5_ENABLED",
        defaultValue: false,
        hint: "Off until the bridge passes its check. cTrader remains the default source when off.",
      },
    ],
  },
  telegram: {
    provider: "telegram",
    label: "Telegram",
    description:
      "Bot used for signal notifications and account linking. Create or reuse one with @BotFather.",
    fields: [
      {
        key: "botToken",
        label: "Bot token",
        kind: "secret",
        env: "TELEGRAM_BOT_TOKEN",
        required: true,
        maxLength: 500,
        hint: "From @BotFather; encrypted at rest.",
      },
      {
        key: "botUsername",
        label: "Bot username",
        kind: "text",
        env: "TELEGRAM_BOT_USERNAME",
        required: true,
        maxLength: 64,
        placeholder: "YourBot",
        hint: "Without the @. Must match the username assigned by @BotFather; used for the t.me link.",
      },
      {
        key: "enabled",
        label: "Notifications enabled",
        kind: "boolean",
        env: "TELEGRAM_ENABLED",
        defaultValue: true,
        hint: "Turns delivery off without clearing the token.",
      },
      {
        key: "linkTtlMinutes",
        label: "Link code lifetime (minutes)",
        kind: "number",
        env: "TELEGRAM_LINK_TTL_MINUTES",
        defaultValue: 15,
        integer: true,
        min: 1,
        max: 60,
      },
    ],
  },
  smtp: {
    provider: "smtp",
    label: "Email (SMTP)",
    description:
      "Password reset, email verification and admin invites. Works with Mailgun, Postmark, SES, Google Workspace or your own mail server.",
    fields: [
      {
        key: "host",
        label: "SMTP host",
        kind: "text",
        env: "SMTP_HOST",
        required: true,
        maxLength: 255,
        placeholder: "smtp.mailgun.org",
        hint: "Mailgun: smtp.mailgun.org (US) or smtp.eu.mailgun.org (EU).",
      },
      {
        key: "port",
        label: "Port",
        kind: "number",
        env: "SMTP_PORT",
        defaultValue: 587,
        integer: true,
        min: 1,
        max: 65535,
        hint: "587 is STARTTLS; 465 is implicit TLS; 25 is usually blocked by hosts.",
      },
      {
        key: "encryption",
        label: "Encryption",
        kind: "select",
        env: "SMTP_ENCRYPTION",
        defaultValue: "starttls",
        options: [
          { value: "starttls", label: "STARTTLS (recommended)" },
          { value: "tls", label: "Implicit TLS" },
          { value: "none", label: "None (local relay only)" },
        ],
      },
      {
        key: "username",
        label: "Username",
        kind: "text",
        env: "SMTP_USER",
        maxLength: 255,
        hint: "Leave empty only for an unauthenticated local relay.",
      },
      {
        key: "password",
        label: "Password",
        kind: "secret",
        env: "SMTP_PASSWORD",
        maxLength: 500,
        hint: "Encrypted at rest. Mailgun uses its SMTP password, not the API key.",
      },
      {
        key: "fromEmail",
        label: "From address",
        kind: "text",
        env: "SMTP_FROM_EMAIL",
        required: true,
        format: "email",
        maxLength: 320,
        placeholder: "noreply@your-domain.com",
        hint: "The provider must authorize this sender/domain (SPF, DKIM, DMARC).",
      },
      {
        key: "fromName",
        label: "From name",
        kind: "text",
        env: "SMTP_FROM_NAME",
        maxLength: 120,
        placeholder: "Your product",
        hint: "Defaults to the configured branding name when left empty.",
      },
    ],
  },
  ai: {
    provider: "ai",
    label: "AI provider",
    description:
      "Turns on the daily briefing narrative and future AI-assisted features. Pick a provider, add its key, test the connection, then save. Features stay off until a working key is stored.",
    fields: [
      {
        key: "provider",
        label: "Provider",
        kind: "select",
        env: "AI_PROVIDER",
        defaultValue: "openai",
        options: [
          { value: "openai", label: "OpenAI (api.openai.com)" },
          { value: "openrouter", label: "OpenRouter (openrouter.ai)" },
          { value: "groq", label: "Groq (api.groq.com)" },
          { value: "nvidia", label: "NVIDIA (integrate.api.nvidia.com)" },
          { value: "ollama", label: "Ollama (local, localhost:11434)" },
          { value: "custom", label: "Custom (enter a base URL)" },
        ],
        hint: "Selecting a provider uses its known endpoint and recommended models. Use Custom only for another OpenAI-compatible endpoint.",
      },
      {
        key: "apiKey",
        label: "API key",
        kind: "secret",
        env: "OPENAI_API_KEY",
        maxLength: 500,
        hint: "Encrypted at rest and never returned to the browser. Ollama does not need a key.",
      },
      {
        key: "baseUrl",
        label: "API base URL",
        kind: "text",
        env: "AI_BASE_URL",
        format: "url",
        maxLength: 300,
        hint: "Filled automatically for known providers. For Custom, paste the chat-completions base URL including the version segment (usually ending in /v1). A trailing slash is ignored.",
      },
      {
        key: "model",
        label: "Model",
        kind: "text",
        env: "AI_MODEL",
        maxLength: 120,
        placeholder: "gpt-4o-mini",
        hint: "Leave empty to use the provider's recommended model. Any chat model the endpoint accepts works.",
      },
    ],
  },
  imap: {
    provider: "imap",
    label: "Inbox (IMAP)",
    description:
      "Reads the dedicated mailbox that receives the daily AI market analysis. The server polls it, copies the market cards and their charts into Session Analysis, and never exposes the mailbox password.",
    fields: [
      {
        key: "host",
        label: "IMAP host",
        kind: "text",
        env: "IMAP_HOST",
        required: true,
        maxLength: 255,
        placeholder: "imap.gmail.com",
        hint: "The dedicated mailbox host, not the personal address that forwards into it.",
      },
      {
        key: "port",
        label: "Port",
        kind: "number",
        env: "IMAP_PORT",
        defaultValue: 993,
        integer: true,
        min: 1,
        max: 65535,
        hint: "993 is implicit TLS; 143 is usually STARTTLS.",
      },
      {
        key: "encryption",
        label: "Encryption",
        kind: "select",
        env: "IMAP_ENCRYPTION",
        defaultValue: "tls",
        options: [
          { value: "tls", label: "Implicit TLS (recommended)" },
          { value: "starttls", label: "STARTTLS" },
          { value: "none", label: "None (local relay only)" },
        ],
      },
      {
        key: "username",
        label: "Username",
        kind: "text",
        env: "IMAP_USER",
        required: true,
        maxLength: 255,
        placeholder: "analysis@your-domain.com",
        hint: "The full mailbox address, including the domain.",
      },
      {
        key: "password",
        label: "Password",
        kind: "secret",
        env: "IMAP_PASSWORD",
        required: true,
        maxLength: 500,
        hint: "Encrypted at rest. Use an app password, not the normal mailbox password.",
      },
      {
        key: "folder",
        label: "Folder",
        kind: "text",
        env: "IMAP_FOLDER",
        defaultValue: "INBOX",
        maxLength: 255,
        hint: "Folder that receives the forwarded daily email.",
      },
      {
        key: "senderFilter",
        label: "Sender filter",
        kind: "text",
        env: "IMAP_SENDER_FILTER",
        maxLength: 320,
        placeholder: "ai.analysis@getleveraged.com",
        hint: "Only import messages from this address. Leave empty to accept any sender.",
      },
      {
        key: "subjectFilter",
        label: "Subject filter",
        kind: "text",
        env: "IMAP_SUBJECT_FILTER",
        maxLength: 200,
        placeholder: "AI Market Analysis",
        hint: "Only import messages whose subject contains this text. Leave empty to accept any subject.",
      },
      {
        key: "pollMinutes",
        label: "Check every (minutes)",
        kind: "number",
        env: "IMAP_POLL_MINUTES",
        defaultValue: 360,
        integer: true,
        min: 5,
        max: 10080,
        hint: "The server polls on this cadence. Administrators can also run a check from the Integrations page.",
      },
      {
        key: "enabled",
        label: "Import enabled",
        kind: "boolean",
        env: "IMAP_ENABLED",
        defaultValue: true,
        hint: "Turns polling off without clearing the mailbox credentials.",
      },
    ],
  },
};
export function isIntegrationProvider(value: unknown): value is IntegrationProvider {
  return typeof value === "string" && value in INTEGRATION_DEFS;
}

export function integrationField(
  provider: IntegrationProvider,
  key: string
): IntegrationFieldDef | undefined {
  return INTEGRATION_DEFS[provider].fields.find((field) => field.key === key);
}

/**
 * AAD for a stored secret. Binding the provider and field means a ciphertext
 * cannot be copied from one field to another and still decrypt.
 */
export function integrationAad(provider: IntegrationProvider, field: string): string {
  return `${provider}:${field}`;
}
