// Generic SMTP transport. The product never hardcodes a provider: buyers can
// point this at Mailgun, Postmark, SES, Google Workspace or their own relay.

import nodemailer from "nodemailer";

import { getSiteSettings } from "../settings/store";
import { resolveIntegration } from "../integrations/store";
import { validateSmtpSetup } from "../integrations/smtpSetup";
import type { EmailContent } from "./templates";

export class EmailNotConfiguredError extends Error {
  constructor(message = "Email delivery is not configured.") {
    super(message);
    this.name = "EmailNotConfiguredError";
  }
}

export interface SmtpValues {
  host: string;
  port: number;
  encryption: "starttls" | "tls" | "none";
  username?: string;
  password?: string;
  fromEmail: string;
  fromName?: string;
}

export interface OutgoingEmail extends EmailContent {
  to: string;
}

function asSmtpValues(values: Record<string, unknown>): SmtpValues {
  const host = String(values.host ?? "").trim();
  const fromEmail = String(values.fromEmail ?? "").trim();
  const port = Number(values.port ?? 587);
  const encryption = values.encryption === "tls" || values.encryption === "none"
    ? values.encryption
    : "starttls";
  if (!host || !fromEmail) throw new EmailNotConfiguredError();
  return {
    host,
    port,
    encryption,
    username: String(values.username ?? "").trim() || undefined,
    password: String(values.password ?? "") || undefined,
    fromEmail,
    fromName: String(values.fromName ?? "").trim() || undefined,
  };
}

export function smtpTransportOptions(values: SmtpValues) {
  return {
    host: values.host,
    port: values.port,
    secure: values.encryption === "tls",
    requireTLS: values.encryption === "starttls",
    ignoreTLS: values.encryption === "none",
    auth: values.username
      ? { user: values.username, pass: values.password ?? "" }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

function quoteName(name: string): string {
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function fromAddress(values: SmtpValues, brand: string): string {
  const name = values.fromName || brand;
  return name ? `${quoteName(name)} <${values.fromEmail}>` : values.fromEmail;
}

/** Resolve the saved/environment SMTP config, or null when it is not usable. */
export async function resolvedSmtp(): Promise<SmtpValues | null> {
  try {
    const resolved = await resolveIntegration("smtp");
    if (resolved.missing.length > 0) return null;
    if (validateSmtpSetup(resolved.values).errors.length > 0) return null;
    return asSmtpValues(resolved.values);
  } catch {
    return null;
  }
}

export async function emailConfigured(): Promise<boolean> {
  return (await resolvedSmtp()) !== null;
}

async function sendWith(values: SmtpValues, message: OutgoingEmail): Promise<void> {
  const settings = await getSiteSettings();
  const transporter = nodemailer.createTransport(smtpTransportOptions(values));
  try {
    await transporter.sendMail({
      from: fromAddress(values, settings.branding.name),
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } finally {
    transporter.close();
  }
}

/** Send an email using the saved SMTP integration. */
export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const values = await resolvedSmtp();
  if (!values) throw new EmailNotConfiguredError();
  await sendWith(values, message);
}

/** Used by the admin Test button with unsaved draft values. */
export async function sendTestEmail(values: SmtpValues, to: string): Promise<void> {
  const settings = await getSiteSettings();
  const brand = settings.branding.name.trim();
  await sendWith(values, {
    to,
    subject: brand ? `${brand}: SMTP test` : "SMTP test",
    text: "Your SMTP settings are working. This is a test message.",
    html: "<p>Your SMTP settings are working. This is a test message.</p>",
  });
}

export { asSmtpValues };
