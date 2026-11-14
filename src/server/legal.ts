import type { LegalSettings } from "./settings/types";

export function legalAcceptanceRequired(
  legal: Pick<LegalSettings, "termsUrl" | "privacyUrl">
): boolean {
  return Boolean(legal.termsUrl || legal.privacyUrl);
}

export function legalAcceptanceSatisfied(
  legal: Pick<LegalSettings, "termsUrl" | "privacyUrl">,
  acceptedTerms: unknown
): boolean {
  return !legalAcceptanceRequired(legal) || acceptedTerms === true;
}
