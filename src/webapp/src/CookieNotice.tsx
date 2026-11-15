// Site-wide notice for the only cookies/browser storage this app uses.
//
// There are no analytics or advertising cookies to opt into, so this is an
// acknowledgment rather than a consent manager. It still explains what is
// stored and links the admin-configured privacy/terms pages.

import { useEffect, useState } from "react";
import { Cookie } from "lucide-react";

import { Button } from "./components/ui";
import { acknowledgeCookies, hasCookieConsent } from "./consent";
import { FALLBACK_LEGAL, useSiteConfig } from "./siteConfig";

export function CookieNotice() {
  const [visible, setVisible] = useState(false);
  const { config } = useSiteConfig();
  const legal = config?.legal ?? FALLBACK_LEGAL;
  const analytics = config?.seo.analyticsProvider ?? "none";

  useEffect(() => {
    if (!hasCookieConsent()) setVisible(true);
    const onChange = () => setVisible(!hasCookieConsent());
    window.addEventListener("doochyweb:consent-changed", onChange);
    return () => window.removeEventListener("doochyweb:consent-changed", onChange);
  }, []);

  if (!visible) return null;

  function accept() {
    acknowledgeCookies();
    setVisible(false);
  }

  const termsHref = legal.termsUrl || "/terms";
  const privacyHref = legal.privacyUrl || "/privacy";

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
            your preferences and secure cTrader sign-in.
            {analytics === "none"
              ? " It does not use analytics or advertising cookies."
              : " Optional analytics loads only after you accept."}
            {" "}
            See the{" "}
            <a
              href={termsHref}
              className="text-accent underline-offset-2 hover:underline"
            >
              Terms
            </a>{" "}
            and{" "}
            <a
              href={privacyHref}
              className="text-accent underline-offset-2 hover:underline"
            >
              Privacy Policy
            </a>
            , and our{" "}
            <a href="/cookies" className="text-accent underline-offset-2 hover:underline">
              Cookie Policy
            </a>
            .
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
