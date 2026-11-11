// Site-wide announcement bar rendered under the header.
//
// The content, tone and schedule come from the admin settings document. A
// dismissed banner is remembered per browser, keyed by its content, so editing
// the announcement makes it appear again for everyone.

import { useState } from "react";
import { X } from "lucide-react";

import type { AnnouncementSettings, AnnouncementTone } from "./api";

const DISMISS_KEY = "doochyweb_announcement_dismissed";

const TONE_CLASS: Record<AnnouncementTone, string> = {
  info: "border-accent/30 bg-accent-soft",
  success: "border-success/30 bg-success-soft",
  warning: "border-amber-500/30 bg-amber-500/10",
  danger: "border-danger/30 bg-danger-soft",
};

function signatureOf(announcement: AnnouncementSettings): string {
  return [
    announcement.text,
    announcement.tone,
    announcement.linkUrl,
    announcement.startsAt ?? "",
    announcement.endsAt ?? "",
  ].join("|");
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function isScheduled(announcement: AnnouncementSettings): boolean {
  const now = Date.now();
  if (announcement.startsAt) {
    const start = Date.parse(announcement.startsAt);
    if (Number.isFinite(start) && now < start) return false;
  }
  if (announcement.endsAt) {
    const end = Date.parse(announcement.endsAt);
    if (Number.isFinite(end) && now > end) return false;
  }
  return true;
}

export function AnnouncementBanner({ announcement }: { announcement: AnnouncementSettings }) {
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  if (!announcement.enabled || !announcement.text.trim() || !isScheduled(announcement)) {
    return null;
  }

  const signature = signatureOf(announcement);
  if (announcement.dismissible && dismissed === signature) return null;

  function dismiss() {
    setDismissed(signature);
    try {
      localStorage.setItem(DISMISS_KEY, signature);
    } catch {
      // Private browsing can reject storage; the banner stays dismissed for this tab.
    }
  }

  const external = /^https?:\/\//i.test(announcement.linkUrl);

  return (
    <div className={`border-b ${TONE_CLASS[announcement.tone]}`} role="status">
      <div className="mx-auto flex max-w-page items-center gap-3 px-4 py-2 text-xs sm:px-6">
        <p className="min-w-0 flex-1 leading-relaxed text-fg">{announcement.text}</p>
        {announcement.linkUrl && (
          <a
            href={announcement.linkUrl}
            {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
            className="shrink-0 font-semibold text-accent underline decoration-accent/40 underline-offset-2 transition hover:text-accent-hover"
          >
            {announcement.linkLabel || "Learn more"}
          </a>
        )}
        {announcement.dismissible && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss announcement"
            title="Dismiss"
            className="shrink-0 rounded-md p-1 text-fg-muted transition hover:bg-surface-active hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export default AnnouncementBanner;
