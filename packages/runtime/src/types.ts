export interface Policy {
  maxSession: bigint;
  expiryMs: number;
  allowedProviders: Set<string>;
}

export interface UsageSnapshot {
  sessionId: string;
  totalCap: bigint;
  consumedAmount: bigint;
  remainingAmount: bigint;
  requestCount: number;
  status: "ACTIVE" | "EXPIRED" | "SETTLED" | "ERRED";
}

export interface ProviderResponse {
  data: unknown;
  cost: bigint;
  cumulativeSpent: bigint;
  receiptSignature: string;
}
