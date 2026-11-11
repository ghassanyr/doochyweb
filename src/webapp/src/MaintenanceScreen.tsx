// Full-screen maintenance notice.
//
// Rendered when the public config says maintenance is on and the visitor is not
// an allowed admin. The message is admin-edited; the mark and name come from
// branding so a white-label deployment still looks like itself.

import { LogIn, Wrench } from "lucide-react";

import { Button } from "./components/ui";
import { useSiteConfig } from "./siteConfig";

export function MaintenanceScreen({
  message,
  canSignIn,
  onSignIn,
}: {
  message: string;
  /** Admins can sign in to turn maintenance off, unless the site disabled it. */
  canSignIn: boolean;
  onSignIn: () => void;
}) {
  const { branding } = useSiteConfig();
  const logoUrl = branding.logoUrl || "/doochy-mark-80.png";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex items-center gap-3">
        <img src={logoUrl} alt="" width={44} height={44} className="h-11 w-11" aria-hidden="true" />
        <div className="text-left">
          <div className="text-lg font-bold tracking-tight text-fg">
            {branding.name || "Doochy"}
          </div>
          {branding.tagline && (
            <div className="text-[11px] text-fg-muted">{branding.tagline}</div>
          )}
        </div>
      </div>

      <div className="mt-10 flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-soft text-accent">
        <Wrench className="h-5 w-5" />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-fg">
        We&rsquo;ll be right back
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-fg-muted">{message}</p>

      {canSignIn ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-6"
          icon={<LogIn className="h-4 w-4" />}
          onClick={onSignIn}
        >
          Admin sign in
        </Button>
      ) : (
        <p className="mt-6 text-[11px] text-fg-faint">
          An administrator can turn maintenance mode off.
        </p>
      )}
    </div>
  );
}

export default MaintenanceScreen;
