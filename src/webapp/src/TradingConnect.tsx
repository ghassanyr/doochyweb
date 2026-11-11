import { useState } from "react";
import { ArrowRight, Plug } from "lucide-react";

import type { ConnectInput } from "./api";
import ConnectPanel from "./ConnectPanel";
import { Button, Card } from "./components/ui";
import { FadeRise } from "./components/motion";

// Shown on the Trading tab when the signed-in user has no cTrader credentials.
// Connecting is an explicit choice here: registration no longer drops people
// into the credential form, and the rest of the app stays available.
export default function TradingConnect({
  onConnected,
  onSkip,
  oauthAvailable = false,
}: {
  onConnected: (creds: ConnectInput) => Promise<void>;
  onSkip: () => void;
  oauthAvailable?: boolean;
}) {
  const [showForm, setShowForm] = useState(false);

  if (showForm) {
    return (
      <ConnectPanel
        variant="inline"
        oauthAvailable={oauthAvailable}
        onConnected={onConnected}
        onCancel={() => setShowForm(false)}
      />
    );
  }

  return (
    <FadeRise>
      <div className="mx-auto w-full max-w-lg">
        <Card className="p-8 text-center shadow-overlay">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Plug className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-xl font-semibold tracking-tight text-fg">
            No trading account connected
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            Connect a cTrader OpenAPI account to see balances, positions and orders here. You can
            connect now, or skip and set it up later from the Trading tab.
          </p>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Button
              variant="primary"
              size="lg"
              icon={<Plug className="h-4 w-4" />}
              onClick={() => setShowForm(true)}
            >
              Connect cTrader
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon={<ArrowRight className="h-4 w-4" />}
              onClick={onSkip}
            >
              Skip for now
            </Button>
          </div>
        </Card>
      </div>
    </FadeRise>
  );
}
