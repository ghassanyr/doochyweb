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

function layout(brand: string, heading: string, intro: string, action: string, url: string, footer: string): string {
  const safeBrand = escapeHtml(brand);
  const safeHeading = escapeHtml(heading);
  const safeIntro = escapeHtml(intro);
  const safeAction = escapeHtml(action);
  const safeUrl = escapeHtml(url);
  const safeFooter = escapeHtml(footer);
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
        <tr><td style="padding:28px">
          <p style="margin:0 0 20px;font-size:14px;font-weight:700;color:#0f766e">${safeBrand}</p>
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">${safeHeading}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155">${safeIntro}</p>
          <p style="margin:0 0 24px"><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700">${safeAction}</a></p>
          <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#64748b">If the button does not work, copy this link into your browser:</p>
          <p style="margin:0 0 24px;font-size:12px;line-height:1.6;word-break:break-all"><a href="${safeUrl}" style="color:#0f766e">${safeUrl}</a></p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b">${safeFooter}</p>
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

export function verifyEmailEmail(input: {
  brand: string;
  url: string;
  expiresMinutes: number;
}): EmailContent {
  return {
    subject: `Verify your email for ${input.brand}`,
    text:
      `Confirm your email address for ${input.brand}.\n\n` +
      `Open this link:\n${input.url}\n\n` +
      `The link expires in ${input.expiresMinutes} minutes.`,
    html: layout(
      input.brand,
      "Verify your email",
      `Confirm your email address for ${input.brand}.`,
      "Verify email",
      input.url,
      `This link expires in ${input.expiresMinutes} minutes.`
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
