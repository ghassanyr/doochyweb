import { useState } from "react";
import { ArrowRight, Plug } from "lucide-react";

import type { ConnectInput } from "./api";
import ConnectPanel from "./ConnectPanel";
import Mt5ConnectPanel from "./Mt5ConnectPanel";
import { Button, Card } from "./components/ui";
import { FadeRise } from "./components/motion";
import { useSiteConfig } from "./siteConfig";

// Shown on the Trading tab when the signed-in user has no cTrader credentials.
// Connecting is an explicit choice here: registration no longer drops people
// into the credential form, and the rest of the app stays available.
export default function TradingConnect({
  onConnected,
  onMt5Changed,
  onSkip,
  oauthAvailable = false,
  manualAvailable = false,
  hasMt5Accounts = false,
}: {
  onConnected: (creds: ConnectInput) => Promise<void>;
  onMt5Changed: () => Promise<void>;
  onSkip: () => void;
  oauthAvailable?: boolean;
  manualAvailable?: boolean;
  hasMt5Accounts?: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [showMt5Form, setShowMt5Form] = useState(false);
  const { content } = useSiteConfig();

  if (showMt5Form) {
    return (
      <Mt5ConnectPanel
        onCancel={() => setShowMt5Form(false)}
        onConnected={async () => {
          setShowMt5Form(false);
          await onMt5Changed();
        }}
      />
    );
  }

  if (showForm) {
    return (
      <ConnectPanel
        variant="inline"
        oauthAvailable={oauthAvailable}
        manualAvailable={manualAvailable}
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
            Connect a trading account
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            {hasMt5Accounts
              ? "Your MT5 account is connected and its history is available in the journal. You can also connect cTrader for live positions and orders."
              : content.emptyStates.trading}
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
              icon={<Plug className="h-4 w-4" />}
              onClick={() => setShowMt5Form(true)}
            >
              Connect MT5
            </Button>
            <Button
              variant="ghost"
              size="lg"
              icon={<ArrowRight className="h-4 w-4" />}
              onClick={onSkip}
            >
              Skip for now
            </Button>
          </div>
          <p className="mt-3 text-[11px] text-fg-faint">MT5 access is read-only.</p>
        </Card>
      </div>
    </FadeRise>
  );
}
