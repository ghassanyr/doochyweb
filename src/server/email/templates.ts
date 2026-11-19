// Branded transactional copy. The visual shell is intentionally simple and
// inline-styled so it survives mail clients that strip <style> blocks.

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailTheme {
  canvas: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentFg: string;
  radius: number;
  dark?: boolean;
}

const LIGHT_EMAIL_THEME: EmailTheme = {
  canvas: "#f1f5f9",
  surface: "#ffffff",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  accent: "#0f766e",
  accentFg: "#ffffff",
  radius: 12,
};

/** Default dark site palette, used by verification mail. */
export const DARK_EMAIL_THEME: EmailTheme = {
  canvas: "#0a0e14",
  surface: "#141c28",
  border: "#233044",
  text: "#e7edf5",
  muted: "#94a3b8",
  accent: "#14b8a6",
  accentFg: "#04231f",
  radius: 10,
  dark: true,
};

function cssColor(value: string, fallback: string): string {
  const clean = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(clean) ? clean : fallback;
}

function themeValues(theme: EmailTheme): EmailTheme {
  const fallback = theme.dark ? DARK_EMAIL_THEME : LIGHT_EMAIL_THEME;
  return {
    canvas: cssColor(theme.canvas, fallback.canvas),
    surface: cssColor(theme.surface, fallback.surface),
    border: cssColor(theme.border, fallback.border),
    text: cssColor(theme.text, fallback.text),
    muted: cssColor(theme.muted, fallback.muted),
    accent: cssColor(theme.accent, fallback.accent),
    accentFg: cssColor(theme.accentFg, fallback.accentFg),
    radius: Number.isFinite(theme.radius) ? Math.min(24, Math.max(0, theme.radius)) : fallback.radius,
    dark: theme.dark,
  };
}

function layout(
  brand: string,
  heading: string,
  intro: string,
  action: string,
  url: string,
  footer: string,
  theme: EmailTheme = LIGHT_EMAIL_THEME
): string {
  const t = themeValues(theme);
  const buttonRadius = Math.max(4, t.radius - 2);
  const colorScheme = t.dark
    ? '<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">'
    : "";
  const safeBrand = escapeHtml(brand);
  const safeHeading = escapeHtml(heading);
  const safeIntro = escapeHtml(intro);
  const safeAction = escapeHtml(action);
  const safeUrl = escapeHtml(url);
  const safeFooter = escapeHtml(footer);
  return `<!doctype html>
<html><head>${colorScheme}</head><body bgcolor="${t.canvas}" style="margin:0;padding:24px;background-color:${t.canvas};font-family:Arial,Helvetica,sans-serif;color:${t.text}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${t.canvas}">
    <tr><td align="center">
      <table role="presentation" width="100%" bgcolor="${t.surface}" style="max-width:560px;background-color:${t.surface};border:1px solid ${t.border};border-radius:${t.radius}px">
        <tr><td style="padding:28px">
          <p style="margin:0 0 20px;font-size:14px;font-weight:700;color:${t.accent}">${safeBrand}</p>
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${t.text}">${safeHeading}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${t.muted}">${safeIntro}</p>
          <p style="margin:0 0 24px"><a href="${safeUrl}" bgcolor="${t.accent}" style="display:inline-block;padding:12px 18px;background-color:${t.accent};color:${t.accentFg};text-decoration:none;border-radius:${buttonRadius}px;font-weight:700">${safeAction}</a></p>
          <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:${t.muted}">If the button does not work, copy this link into your browser:</p>
          <p style="margin:0 0 24px;font-size:12px;line-height:1.6;word-break:break-all"><a href="${safeUrl}" style="color:${t.accent}">${safeUrl}</a></p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:${t.muted}">${safeFooter}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function passwordResetEmail(input: {
  brand: string;
  url: string;
  expiresMinutes: number;
}): EmailContent {
  return {
    subject: `Reset your ${input.brand} password`,
    text:
      `We received a request to reset your ${input.brand} password.\n\n` +
      `Open this link to choose a new password:\n${input.url}\n\n` +
      `The link expires in ${input.expiresMinutes} minutes. If you did not request it, you can ignore this email.`,
    html: layout(
      input.brand,
      "Reset your password",
      `We received a request to reset your ${input.brand} password.`,
      "Choose a new password",
      input.url,
      `This link expires in ${input.expiresMinutes} minutes. If you did not request it, ignore this email.`
    ),
  };
}

export function verifyEmailEmail(
  input: {
    brand: string;
    url: string;
    expiresMinutes: number;
  },
  theme: EmailTheme = DARK_EMAIL_THEME
): EmailContent {
  return {
    subject: `Verify your email for ${input.brand}`,
    text:
      `Confirm your email address for ${input.brand}.\n\n` +
      `Click this button:\n${input.url}\n\n` +
      `The link expires in ${input.expiresMinutes} minutes.\n\n` +
      `Opening the link verifies your email and signs you in.`,
    html: layout(
      input.brand,
      "Verify your email",
      `Confirm your email address for ${input.brand}.`,
      "Verify email",
      input.url,
      `This link expires in ${input.expiresMinutes} minutes. Opening it signs you in.`,
      theme
    ),
  };
}

export function adminInviteEmail(input: {
  brand: string;
  url: string;
  username: string;
  expiresMinutes: number;
}): EmailContent {
  return {
    subject: `You are invited to ${input.brand}`,
    text:
      `An administrator invited you to ${input.brand} as ${input.username}.\n\n` +
      `Open this link to set your password:\n${input.url}\n\n` +
      `The link expires in ${input.expiresMinutes} minutes.`,
    html: layout(
      input.brand,
      `You are invited to ${input.brand}`,
      `An administrator invited you as ${input.username}.`,
      "Set your password",
      input.url,
      `This link expires in ${input.expiresMinutes} minutes.`
    ),
  };
}

// ---------------------------------------------------------------------------
// Admin-editable copy
// ---------------------------------------------------------------------------

export type TemplateVars = Record<string, string | number | null | undefined>;

/** Replace {{name}} placeholders; unknown placeholders are left untouched. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key: string) => {
    if (!(key in vars)) return match;
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}

export interface EmailAction {
  label: string;
  url: string;
}

function textLayout(
  brand: string,
  body: string,
  theme: EmailTheme = LIGHT_EMAIL_THEME,
  action?: EmailAction
): string {
  const t = themeValues(theme);
  const buttonRadius = Math.max(4, t.radius - 2);
  const colorScheme = t.dark
    ? '<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">'
    : "";
  const safeBrand = escapeHtml(brand);
  const safeActionUrl = action ? escapeHtml(action.url) : "";
  const safeActionLabel = action ? escapeHtml(action.label) : "";
  const button = action
    ? `<a href="${safeActionUrl}" bgcolor="${t.accent}" style="display:inline-block;padding:12px 18px;background-color:${t.accent};color:${t.accentFg};text-decoration:none;border-radius:${buttonRadius}px;font-weight:700">${safeActionLabel}</a>`
    : "";
  const paragraphs = escapeHtml(body)
    .split(/\n{2,}/)
    .map((part) => {
      if (action && part.includes(safeActionUrl)) {
        const lines = part
          .split(/\n/)
          .map((line) => (line.trim() === safeActionUrl ? button : line));
        return `<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:${t.text}">${lines.join("<br>")}</p>`;
      }
      return `<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:${t.text}">${part.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
  return `<!doctype html>
<html><head>${colorScheme}</head><body bgcolor="${t.canvas}" style="margin:0;padding:24px;background-color:${t.canvas};font-family:Arial,Helvetica,sans-serif;color:${t.text}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${t.canvas}">
    <tr><td align="center">
      <table role="presentation" width="100%" bgcolor="${t.surface}" style="max-width:560px;background-color:${t.surface};border:1px solid ${t.border};border-radius:${t.radius}px">
        <tr><td style="padding:28px">
          <p style="margin:0 0 20px;font-size:14px;font-weight:700;color:${t.accent}">${safeBrand}</p>
          ${paragraphs}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Build an email from an admin-stored subject and body. */
export function renderEmailTemplate(
  template: { subject: string; body: string },
  vars: TemplateVars,
  theme: EmailTheme = LIGHT_EMAIL_THEME,
  action?: EmailAction
): EmailContent {
  const brand = String(vars.brand ?? "");
  const rendered = renderTemplate(template.body, vars).trim();
  const text = action ? rendered.replace(/Open this link:/g, "Click this button:") : rendered;
  return {
    subject: renderTemplate(template.subject, vars).trim(),
    text,
    html: textLayout(brand, text, theme, action),
  };
}
