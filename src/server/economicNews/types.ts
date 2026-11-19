export interface ParsedEconomicNewsEvent {
  eventKey: string;
  country: string;
  startsAt: string;
  title: string;
}

export interface ParsedEconomicNews {
  generatedAt: string | null;
  events: ParsedEconomicNewsEvent[];
}

export interface EconomicNewsEvent {
  eventKey: string;
  country: string;
  startsAt: string;
  title: string;
  subject: string;
  generatedAt: string | null;
  receivedAt: string | null;
  lastSeenAt: string;
}

export interface EconomicNewsResponse {
  events: EconomicNewsEvent[];
  latestReceivedAt: string | null;
}

export interface EconomicNewsMeta {
  subject: string;
  generatedAt: string | null;
  receivedAt: string | null;
}
