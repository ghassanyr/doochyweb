// Shared cookie/storage acknowledgement. The notice and the analytics loader
// both use this key so enabling consent-gated analytics never requires a second
// prompt.

export const COOKIE_CONSENT_KEY = "doochyweb_cookie_notice_v1";
export const CONSENT_CHANGED_EVENT = "doochyweb:consent-changed";

export function hasCookieConsent(): boolean {
  try {
    return localStorage.getItem(COOKIE_CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}

export function acknowledgeCookies(): void {
  try {
    localStorage.setItem(COOKIE_CONSENT_KEY, "accepted");
  } catch {
    // Storage can be blocked; still update this page and its listeners.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
  }
}
