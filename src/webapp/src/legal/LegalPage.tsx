// Public legal pages. The copy is deliberately general: it explains how this
// software handles accounts, trading data and browser storage without claiming
// a specific jurisdiction. Operators can override the Terms and Privacy links
// from site settings when they have counsel-reviewed versions.

import {
  ChevronRight,
  Cookie,
  FileText,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { FadeRise } from "../components/motion";
import { RouteLink } from "../components/RouteLink";
import { Card } from "../components/ui";
import type { ViewKey } from "../routing";
import { FALLBACK_BRANDING, FALLBACK_LEGAL, useSiteConfig } from "../siteConfig";

export type LegalView = "legal" | "terms" | "privacy" | "risk" | "cookies";

export const LEGAL_VIEWS: readonly LegalView[] = [
  "legal",
  "terms",
  "privacy",
  "risk",
  "cookies",
];

export function isLegalView(view: ViewKey): view is LegalView {
  return (LEGAL_VIEWS as readonly string[]).includes(view);
}

interface PolicySection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
}

interface PolicyDocument {
  view: Exclude<LegalView, "legal">;
  title: string;
  summary: string;
  icon: LucideIcon;
  sections: PolicySection[];
}

const UPDATED = "14 November 2026";

const PAGE_ICONS: Record<LegalView, LucideIcon> = {
  legal: ShieldCheck,
  terms: FileText,
  privacy: LockKeyhole,
  risk: TriangleAlert,
  cookies: Cookie,
};

function contactLine(brand: string, supportEmail: string, websiteUrl: string) {
  const parts: string[] = [];
  if (supportEmail) parts.push(`email ${supportEmail}`);
  if (websiteUrl) parts.push(`visit ${websiteUrl}`);
  if (parts.length === 0) {
    return `Contact ${brand} through the support details published on this site.`;
  }
  return `Contact ${brand} by ${parts.join(" or ")}.`;
}

function buildDocuments(
  brand: string,
  supportEmail: string,
  websiteUrl: string
): Record<Exclude<LegalView, "legal">, PolicyDocument> {
  const contact = contactLine(brand, supportEmail, websiteUrl);

  return {
    terms: {
      view: "terms",
      title: "Terms of Service",
      summary: `The agreement between you and ${brand} for using this trading workspace and connecting a cTrader account.`,
      icon: PAGE_ICONS.terms,
      sections: [
        {
          title: "1. Agreement to these terms",
          paragraphs: [
            `These Terms of Service govern access to and use of ${brand} (the "Service"). By creating an account, signing in, or using any part of the Service, you agree to these terms. If you do not agree, do not use the Service.`,
          ],
        },
        {
          title: "2. What the Service does",
          paragraphs: [
            "The Service provides market analysis, published trade ideas, automated breakout research, pattern-training exercises, and optional tools for connecting to and managing a cTrader trading account.",
            "Features may be added, changed, suspended, or removed at any time. Brokerage services are provided by your broker, not by us.",
          ],
        },
        {
          title: "3. Eligibility and account security",
          bullets: [
            "You must be old enough to enter a binding contract and legally permitted to use trading-related services in your jurisdiction.",
            "You must provide accurate account information and keep it up to date.",
            "You are responsible for keeping your login details and cTrader credentials secure, and for all activity under your account.",
            "You must not share your account, tokens, or access with any other person.",
          ],
        },
        {
          title: "4. No financial advice",
          paragraphs: [
            "All analysis, signals, breakout research, training material, and other content are provided for general information and education only. They are not investment, financial, legal, tax, or accounting advice, and are not a recommendation, offer, or solicitation to buy or sell any instrument.",
            "We do not know your objectives, financial situation, or risk tolerance. You are solely responsible for your trading decisions. Seek advice from a suitably qualified professional before acting on any information from the Service.",
          ],
        },
        {
          title: "5. Brokers, orders and market data",
          bullets: [
            "Orders are transmitted to your broker or cTrader platform. Execution, pricing, slippage, margin, and settlement are controlled by them.",
            "We do not hold client money, act as a market maker, or guarantee that an order will be accepted, filled, or filled at a particular price.",
            "Market data may be delayed, incomplete, or unavailable. Quotes and analytics are for reference and may differ from your broker's executable prices.",
            "You must maintain a separate agreement with your broker and comply with their terms, margin rules, and market-data permissions.",
          ],
        },
        {
          title: "6. Acceptable use",
          bullets: [
            "Do not use the Service for unlawful, fraudulent, or abusive activity.",
            "Do not attempt to gain unauthorised access to accounts, systems, or data.",
            "Do not scrape, copy, resell, or redistribute the Service or its content except as expressly permitted.",
            "Do not interfere with the Service, introduce malicious code, or place unreasonable load on our systems.",
          ],
        },
        {
          title: "7. Intellectual property",
          paragraphs: [
            `The Service, including its software, design, analysis methods, training content, and branding, is owned by ${brand} or its licensors and is protected by applicable intellectual-property laws.`,
            "You receive a limited, personal, non-exclusive, non-transferable licence to use the Service for your own internal purposes. All other rights are reserved.",
          ],
        },
        {
          title: "8. Disclaimers",
          paragraphs: [
            'The Service is provided "as is" and "as available". To the maximum extent permitted by law, we disclaim all warranties, express or implied, including warranties of accuracy, availability, fitness for a particular purpose, and non-infringement.',
            "We do not warrant that the Service will be uninterrupted, error-free, or free of harmful components, or that any data will be accurate or complete.",
          ],
        },
        {
          title: "9. Limitation of liability",
          paragraphs: [
            "To the maximum extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, lost trading opportunities, loss of data, or trading losses arising from your use of the Service.",
            "Where liability cannot be excluded, our aggregate liability arising out of or relating to the Service is limited to the greater of the amount you paid to us for the Service in the twelve months before the claim or a nominal amount. Nothing in these terms limits liability that cannot lawfully be limited.",
          ],
        },
        {
          title: "10. Suspension and termination",
          paragraphs: [
            "We may suspend or terminate your access if you breach these terms, if required by law, or if we reasonably believe your use creates a security, legal, or operational risk.",
            "You may stop using the Service at any time. Provisions that by their nature should survive termination, including intellectual property, disclaimers, and liability limits, will continue to apply.",
          ],
        },
        {
          title: "11. Changes to these terms",
          paragraphs: [
            "We may update these terms from time to time. The updated version will be posted on this page with a new effective date. Continued use after the effective date means you accept the updated terms.",
          ],
        },
        {
          title: "12. Governing law and contact",
          paragraphs: [
            "These terms are governed by the laws applicable to the operator of the Service in its principal place of business, without regard to conflict-of-law rules. Courts in that jurisdiction have exclusive jurisdiction, except where mandatory consumer protections provide otherwise.",
            contact,
          ],
        },
      ],
    },
    privacy: {
      view: "privacy",
      title: "Privacy Policy",
      summary: `How ${brand} collects, uses, stores, and protects personal information when you use the Service.`,
      icon: PAGE_ICONS.privacy,
      sections: [
        {
          title: "1. Scope",
          paragraphs: [
            `This Privacy Policy explains how ${brand} handles personal information collected through the Service. It does not apply to your broker, cTrader, or other third-party services, which have their own privacy policies.`,
          ],
        },
        {
          title: "2. Information we collect",
          bullets: [
            "Account information such as your email address, username, hashed password, role, and registration settings.",
            "cTrader connection data such as OAuth tokens, trader account IDs, broker names, account balances, positions, orders, and deal history that you choose to connect.",
            "Content and preferences you create, such as watchlists, filters, signal drafts, and training progress.",
            "Technical information such as IP address, browser type, device information, request logs, and error diagnostics.",
            "Communications you send to support or through the Service.",
          ],
        },
        {
          title: "3. How we use information",
          paragraphs: [
            "We use personal information to provide and secure the Service, authenticate you, connect to your cTrader account, display market and account data, save your preferences, send transactional email, respond to support requests, prevent abuse, and comply with legal obligations.",
            "We may also use aggregated or de-identified information to understand how the Service is used and to improve it.",
          ],
        },
        {
          title: "4. Legal bases",
          paragraphs: [
            "Where data-protection law requires a legal basis, we rely on performance of a contract, your consent, our legitimate interests in operating and securing the Service, and compliance with legal obligations.",
          ],
        },
        {
          title: "5. Sharing information",
          bullets: [
            "With cTrader, your broker, and related service providers as needed to authenticate, read account data, and transmit orders you request.",
            "With hosting, database, email, and security providers that process information on our behalf.",
            "With professional advisers, regulators, law enforcement, or other parties where required by law or necessary to protect rights and safety.",
            "As part of a merger, acquisition, financing, or sale of assets, subject to appropriate safeguards.",
            "We do not sell personal information, and we do not use it for third-party advertising.",
          ],
        },
        {
          title: "6. Cookies and browser storage",
          paragraphs: [
            "We use a small number of essential cookies and browser-storage entries to keep you signed in, remember preferences, and complete cTrader sign-in. There are no advertising or analytics cookies in the current build.",
            "See the Cookie Policy for details and for information about controlling storage in your browser.",
          ],
        },
        {
          title: "7. Retention",
          paragraphs: [
            "We retain personal information for as long as your account is active and for a reasonable period afterwards to meet legal, security, and operational requirements. When information is no longer needed, we delete it or anonymise it.",
            "Server logs and security records may be retained for a limited period for troubleshooting and abuse prevention.",
          ],
        },
        {
          title: "8. Security",
          paragraphs: [
            "We use measures such as encrypted connections, hashed passwords, access controls, and token-based integrations. No method of transmission or storage is completely secure, so we cannot guarantee absolute security.",
            "You are responsible for protecting your login details and for promptly notifying us of suspected unauthorised access.",
          ],
        },
        {
          title: "9. Your rights",
          paragraphs: [
            "Depending on your location, you may have the right to access, correct, delete, restrict, or object to processing of your personal information, to receive a portable copy, and to withdraw consent where processing is based on consent.",
            "You may also have the right to complain to your local data-protection authority. To exercise a right, contact us using the details below. We may need to verify your identity.",
          ],
        },
        {
          title: "10. International transfers",
          paragraphs: [
            "The Service and its providers may process information in countries other than your own. Where required, we use contractual or other appropriate safeguards for those transfers.",
          ],
        },
        {
          title: "11. Children",
          paragraphs: [
            "The Service is not intended for children and is not available to anyone below the minimum age for trading-related services in their jurisdiction. If we learn that a child has provided personal information, we will delete it.",
          ],
        },
        {
          title: "12. Changes and contact",
          paragraphs: [
            "We may update this Privacy Policy from time to time. The updated version will be posted here with a new effective date.",
            contact,
          ],
        },
      ],
    },
    risk: {
      view: "risk",
      title: "Risk Disclosure",
      summary: "Important information about the risks of trading leveraged products and relying on market analysis.",
      icon: PAGE_ICONS.risk,
      sections: [
        {
          title: "No financial advice",
          paragraphs: [
            "The Service provides general market information, research, education, and tools. It does not provide personalised financial advice and does not consider your objectives, experience, financial situation, or risk tolerance.",
            "You are responsible for your own decisions. Seek independent professional advice if you are unsure whether trading is suitable for you.",
          ],
        },
        {
          title: "Trading can lose money",
          paragraphs: [
            "Trading foreign exchange, contracts for difference, cryptoassets, and other leveraged products carries a high level of risk and can result in the loss of some or all of your capital. In some circumstances, losses may exceed your deposit depending on your broker's terms.",
            "Never trade with money you cannot afford to lose, and never borrow money to trade.",
          ],
        },
        {
          title: "Leverage and margin",
          paragraphs: [
            "Leverage magnifies both gains and losses. A small adverse price movement can have a large impact on your account. If your account falls below your broker's margin requirements, positions may be closed automatically, possibly at a loss.",
          ],
        },
        {
          title: "Market, liquidity and execution risk",
          bullets: [
            "Prices can gap, especially around news, weekends, holidays, and market opens.",
            "Spreads, slippage, commissions, swaps, and financing costs can reduce returns.",
            "Some markets may become illiquid, making it difficult or impossible to close a position at the expected price.",
            "Orders may be rejected, delayed, partially filled, or filled at a different price than requested.",
          ],
        },
        {
          title: "Past performance and research",
          paragraphs: [
            "Past performance, backtests, hypothetical results, win rates, and published signals are not reliable indicators of future results. Research and automated analysis can be wrong, incomplete, or based on data that later proves inaccurate.",
            "Signals and breakout notes are ideas for further research, not instructions to trade.",
          ],
        },
        {
          title: "Technology and data risk",
          paragraphs: [
            "The Service depends on software, internet connectivity, broker APIs, market-data feeds, and third-party infrastructure. Outages, latency, data errors, authentication failures, or connectivity problems may prevent you from placing, modifying, or closing an order.",
            "You should always have an alternative way to manage open positions, such as your broker's own platform.",
          ],
        },
        {
          title: "Third-party broker risk",
          paragraphs: [
            "Your broker is responsible for holding your funds, executing orders, and meeting its regulatory obligations. We do not control your broker and are not responsible for its solvency, conduct, execution quality, or platform availability.",
          ],
        },
        {
          title: "Suitability",
          paragraphs: [
            "Trading is not suitable for everyone. Before trading, consider your experience, financial resources, investment objectives, and willingness to accept risk. If you do not understand these risks, do not trade.",
          ],
        },
      ],
    },
    cookies: {
      view: "cookies",
      title: "Cookie Policy",
      summary: "The essential cookies and browser-storage entries used by this site, and how to control them.",
      icon: PAGE_ICONS.cookies,
      sections: [
        {
          title: "1. What this policy covers",
          paragraphs: [
            "This policy explains how the Service uses cookies and similar browser storage. A cookie is a small file set by a website; browser storage (localStorage) is data a site stores in your browser.",
          ],
        },
        {
          title: "2. Essential cookies",
          bullets: [
            "ctrader_oauth_state — an HTTP-only cookie set during cTrader sign-in to validate the OAuth state and prevent cross-site request forgery. It expires after about ten minutes and is cleared when the callback completes.",
          ],
        },
        {
          title: "3. Browser storage",
          bullets: [
            "doochyweb_token — keeps you signed in between page loads.",
            "Theme, filter, announcement, and cookie-notice preferences — remember how the interface should look and which notices you have dismissed.",
            "Training progress — stores your local practice session so the daily drill can resume.",
          ],
        },
        {
          title: "4. No analytics or advertising cookies",
          paragraphs: [
            "The current build does not use advertising, tracking, or third-party analytics cookies. If this changes, this policy and the notice will be updated before those cookies are used.",
          ],
        },
        {
          title: "5. Third-party services",
          paragraphs: [
            "When you connect a cTrader account, you are redirected to cTrader's authorization pages. cTrader and your broker may set their own cookies under their own policies. We do not control those cookies.",
          ],
        },
        {
          title: "6. Managing storage",
          paragraphs: [
            "You can delete or block cookies and browser storage through your browser settings. Blocking essential storage may sign you out, reset preferences, or prevent cTrader sign-in from working.",
            "Clearing cookies does not delete your account or your trading history held by your broker.",
          ],
        },
        {
          title: "7. Changes and contact",
          paragraphs: [
            "We may update this Cookie Policy when our storage practices change. The updated version will be posted here with a new effective date.",
            contact,
          ],
        },
      ],
    },
  };
}

export default function LegalPage({
  view,
  onNavigate,
}: {
  view: LegalView;
  onNavigate: (view: ViewKey) => void;
}) {
  const { branding, config } = useSiteConfig();
  const legal = config?.legal ?? FALLBACK_LEGAL;
  const brand = branding.name.trim() || FALLBACK_BRANDING.name;
  const supportEmail = branding.supportEmail.trim();
  const websiteUrl = branding.websiteUrl.trim();
  const documents = buildDocuments(brand, supportEmail, websiteUrl);
  const document = view === "legal" ? null : documents[view];
  const Icon = document?.icon ?? PAGE_ICONS.legal;
  const title = document?.title ?? "Legal & policies";
  const summary =
    document?.summary ??
    `The terms, privacy, risk, and cookie information that apply when you use ${brand}.`;

  return (
    <FadeRise>
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1 text-xs text-fg-faint"
        >
          <RouteLink view="home" onNavigate={onNavigate} className="transition hover:text-accent">
            Home
          </RouteLink>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <RouteLink view="legal" onNavigate={onNavigate} className="transition hover:text-accent">
            Legal
          </RouteLink>
          {view !== "legal" && (
            <>
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
              <span className="text-fg-muted">{title}</span>
            </>
          )}
        </nav>

        <header className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-hairline bg-accent-soft text-accent">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">{title}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-muted">{summary}</p>
            <p className="mt-2 text-[11px] text-fg-faint">Last updated {UPDATED}</p>
          </div>
        </header>

        <PolicyNav current={view} onNavigate={onNavigate} />

        {view === "legal" ? (
          <LegalOverview
            brand={brand}
            legal={legal}
            supportEmail={supportEmail}
            websiteUrl={websiteUrl}
            onNavigate={onNavigate}
          />
        ) : (
          <PolicyBody document={document!} riskDisclaimer={legal.riskDisclaimer} />
        )}

        <Card className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0 text-sm leading-relaxed text-fg-muted">
              <p className="font-semibold text-fg">Questions or requests</p>
              <p className="mt-1">
                {supportEmail ? (
                  <>
                    Contact{" "}
                    <a
                      href={`mailto:${supportEmail}`}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      {supportEmail}
                    </a>{" "}
                    for privacy requests, account questions, or legal enquiries.
                  </>
                ) : (
                  <>Contact {brand} through the support details published on this site.</>
                )}
                {websiteUrl && (
                  <>
                    {" "}
                    You can also visit{" "}
                    <a
                      href={websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      {websiteUrl}
                    </a>
                    .
                  </>
                )}
              </p>
            </div>
          </div>
        </Card>
      </div>
    </FadeRise>
  );
}

function PolicyNav({
  current,
  onNavigate,
}: {
  current: LegalView;
  onNavigate: (view: ViewKey) => void;
}) {
  return (
    <nav
      aria-label="Legal documents"
      className="flex flex-wrap gap-1.5 rounded-lg border border-hairline bg-soft/60 p-1.5"
    >
      {LEGAL_VIEWS.map((view) => (
        <RouteLink
          key={view}
          view={view}
          onNavigate={onNavigate}
          aria-current={current === view ? "page" : undefined}
          className={
            "rounded-md px-3 py-1.5 text-xs font-medium transition " +
            (current === view
              ? "bg-accent-soft text-accent"
              : "text-fg-muted hover:bg-surface-hover hover:text-fg")
          }
        >
          {LABELS[view]}
        </RouteLink>
      ))}
    </nav>
  );
}

const LABELS: Record<LegalView, string> = {
  legal: "Overview",
  terms: "Terms",
  privacy: "Privacy",
  risk: "Risk disclosure",
  cookies: "Cookies",
};

function LegalOverview({
  brand,
  legal,
  supportEmail,
  websiteUrl,
  onNavigate,
}: {
  brand: string;
  legal: typeof FALLBACK_LEGAL;
  supportEmail: string;
  websiteUrl: string;
  onNavigate: (view: ViewKey) => void;
}) {
  const documents = buildDocuments(brand, supportEmail, websiteUrl);
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4 sm:p-5">
        <h2 className="text-sm font-semibold tracking-tight text-fg">Your agreement with {brand}</h2>
        <p className="text-sm leading-relaxed text-fg-muted">
          By creating an account or using the Service, you agree to the Terms of Service and
          acknowledge the Privacy Policy. When you connect a cTrader account or place orders,
          the Risk Disclosure and your broker&rsquo;s own terms also apply.
        </p>
        {legal.riskDisclaimer && (
          <p className="rounded-lg border border-hairline bg-soft/60 p-3 text-xs leading-relaxed text-fg-muted">
            {legal.riskDisclaimer}
          </p>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {(["terms", "privacy", "risk", "cookies"] as const).map((key) => {
          const doc = documents[key];
          const DocIcon = doc.icon;
          return (
            <RouteLink key={key} view={key} onNavigate={onNavigate} className="block h-full">
              <Card interactive className="flex h-full items-start gap-3 p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <DocIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-fg">{doc.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-fg-muted">
                    {doc.summary}
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent">
                    Read more <ChevronRight className="h-3 w-3" aria-hidden="true" />
                  </span>
                </span>
              </Card>
            </RouteLink>
          );
        })}
      </div>
    </div>
  );
}

function PolicyBody({
  document,
  riskDisclaimer,
}: {
  document: PolicyDocument;
  riskDisclaimer: string;
}) {
  return (
    <Card className="space-y-6 p-4 sm:p-6">
      {document.view === "risk" && riskDisclaimer && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
          {riskDisclaimer}
        </p>
      )}
      {document.sections.map((section) => (
        <section key={section.title} className="space-y-2">
          <h2 className="text-sm font-semibold tracking-tight text-fg">{section.title}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph} className="text-sm leading-relaxed text-fg-muted">
              {paragraph}
            </p>
          ))}
          {section.bullets && (
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-muted marker:text-fg-faint">
              {section.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <p className="border-t border-hairline pt-4 text-[11px] leading-relaxed text-fg-faint">
        This document is provided for general information. It is not legal advice, and its
        interpretation may depend on your jurisdiction and your relationship with your broker.
      </p>
    </Card>
  );
}
