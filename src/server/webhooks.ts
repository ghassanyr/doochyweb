// Outbound webhook delivery for operational events.
//
// Payloads are JSON and optionally signed with HMAC SHA-256 using the secret
// stored in Site settings. Delivery is best-effort with a short timeout so a
// slow consumer cannot hold up publishing or alert processing.

import { createHmac, randomUUID } from "node:crypto";

import { getSiteSettings } from "./settings/store";

export type WebhookEvent =
  | "signal.published"
  | "alert.triggered"
  | "webhook.test";

export interface WebhookResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

function eventEnabled(event: WebhookEvent, signalPublished: boolean, alertTriggered: boolean): boolean {
  if (event === "signal.published") return signalPublished;
  if (event === "alert.triggered") return alertTriggered;
  return true;
}

export async function sendWebhook(
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<WebhookResult> {
  let settings;
  try {
    settings = await getSiteSettings();
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
  }
  const webhooks = settings.webhooks;
  if (!webhooks.enabled || !webhooks.url) {
    return { ok: false, status: null, error: "webhooks are disabled" };
  }
  if (!eventEnabled(event, webhooks.signalPublished, webhooks.alertTriggered)) {
    return { ok: false, status: null, error: "event is disabled" };
  }

  const envelope = {
    id: randomUUID(),
    event,
    sentAt: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(envelope);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Doochy-Webhooks/1.0",
    "x-doochy-event": event,
    "x-doochy-delivery": envelope.id,
  };
  if (webhooks.secret) {
    const signature = createHmac("sha256", webhooks.secret).update(body).digest("hex");
    headers["x-doochy-signature"] = `sha256=${signature}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(webhooks.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : `endpoint returned ${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Fire and forget from request handlers that must not wait on consumers. */
export function queueWebhook(event: WebhookEvent, data: Record<string, unknown>): void {
  void sendWebhook(event, data).then((result) => {
    if (!result.ok && result.error !== "webhooks are disabled" && result.error !== "event is disabled") {
      console.error(`[webhooks] ${event} delivery failed: ${result.error}`);
    }
  });
}
