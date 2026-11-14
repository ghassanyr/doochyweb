// Site-wide notice for the only cookies/browser storage this app uses.
//
// There are no analytics or advertising cookies to opt into, so this is an
// acknowledgment rather than a consent manager. It still explains what is
// stored and links the admin-configured privacy/terms pages.

import { useEffect, useState } from "react";
import { Cookie } from "lucide-react";

import { Button } from "./components/ui";
import { FALLBACK_LEGAL, useSiteConfig } from "./siteConfig";

const ACK_KEY = "doochyweb_cookie_notice_v1";

function alreadyAcknowledged(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === "accepted";
  } catch {
    return false;
  }
}

export function CookieNotice() {
  const [visible, setVisible] = useState(false);
  const { config } = useSiteConfig();
  const legal = config?.legal ?? FALLBACK_LEGAL;

  useEffect(() => {
    if (!alreadyAcknowledged()) setVisible(true);
  }, []);

  if (!visible) return null;

  function accept() {
    try {
      localStorage.setItem(ACK_KEY, "accepted");
    } catch {
      // Storage can be blocked; still dismiss for this page load.
    }
    setVisible(false);
  }

  const hasLinks = Boolean(legal.termsUrl || legal.privacyUrl);

  return (
    <section
      aria-label="Cookie and storage notice"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-3xl rounded-2xl border border-hairline-strong bg-surface/95 p-4 text-fg shadow-overlay backdrop-blur"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent sm:flex">
          <Cookie className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold tracking-tight">Cookies and browser storage</p>
          <p className="text-xs leading-relaxed text-fg-muted">
            This site uses essential cookies and browser storage to keep you signed in, remember
            your preferences and secure cTrader sign-in. It does not use advertising or analytics
            cookies.
            {hasLinks && (
              <>
                {" "}
                See{" "}
                {legal.termsUrl && (
                  <a
                    href={legal.termsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    Terms
                  </a>
                )}
                {legal.termsUrl && legal.privacyUrl && " and "}
                {legal.privacyUrl && (
                  <a
                    href={legal.privacyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    Privacy
                  </a>
                )}
                .
              </>
            )}
          </p>
        </div>
        <Button variant="primary" size="sm" className="shrink-0" onClick={accept}>
          Accept
        </Button>
      </div>
    </section>
  );
}

export default CookieNotice;
