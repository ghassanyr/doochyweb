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

export const INTEGRATION_PROVIDERS: readonly IntegrationProvider[] = ["ctrader", "telegram"];

export const INTEGRATION_DEFS: Record<IntegrationProvider, IntegrationProviderDef> = {
  ctrader: {
    provider: "ctrader",
    label: "cTrader",
    description:
      "The Open API app every user connects through. Register it at openapi.ctrader.com/apps and add the callback URL shown by the setup wizard.",
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
        key: "publicBaseUrl",
        label: "Public base URL",
        kind: "text",
        env: "PUBLIC_BASE_URL",
        format: "url",
        maxLength: 300,
        placeholder: "https://your-domain",
        hint: "Public origin of this deployment. The wizard uses it to build the callback URL.",
      },
      {
        key: "redirectUri",
        label: "Callback URL",
        kind: "text",
        env: "CTRADER_REDIRECT_URI",
        required: true,
        format: "url",
        maxLength: 500,
        placeholder: "https://your-domain/callback",
        hint: "Must exactly match a callback URL registered on the cTrader app. The setup wizard fills this in.",
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
        defaultValue: "DoochyBot",
        maxLength: 64,
        placeholder: "DoochyBot",
        hint: "Without the @. Used for the t.me link.",
      },
      {
        key: "baseUrl",
        label: "Public base URL",
        kind: "text",
        env: "PUBLIC_BASE_URL",
        required: true,
        defaultValue: "https://doochy.net",
        format: "url",
        maxLength: 300,
        placeholder: "https://your-domain",
        hint: "Used for bot links and the cTrader callback.",
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
