import { Policy, UsageSnapshot, ProviderResponse } from "./types";
import { PayKitAdapter } from "./adapters/paykit-adapter";

export class BoundedAgentRuntime {
  constructor(
    private readonly channelAdapter: PayKitAdapter,
    private readonly policy: Policy,
  ) {}

  private consumedAmount = 0n;
  private requestCount = 0;
  private status: UsageSnapshot["status"] = "ACTIVE";

  sessionId(): string {
    return this.channelAdapter.getChannelId();
  }

  async request(url: string, init?: RequestInit): Promise<ProviderResponse> {
    if (this.status !== "ACTIVE") {
      throw new Error(`Session is not active. Current status: ${this.status}`);
    }

    this.validateProvider(url);

    if (this.isExpired()) {
      this.status = "EXPIRED";
      throw new Error("Session allowance expired");
    }

    let response = await fetch(url, init);

    if (response.status === 402) {
      const priceHeader =
        response.headers.get("X-Payment-Amount") ||
        response.headers.get("x-payment-amount") ||
        "0";

      const price = BigInt(priceHeader);
      if (price <= 0n) {
        throw new Error("Provider returned 402 without a valid payment amount");
      }

      if (this.policy.maxSession - this.consumedAmount < price) {
        this.status = "ERRED";
        throw new Error("Insufficient session allowance for this request");
      }

      const voucher = await this.channelAdapter.signCumulativeVoucher(price);
      this.consumedAmount += price;
      this.requestCount += 1;

      response = await fetch(url, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${voucher.token}`,
        },
      });
    }

    const data = await response.json();
    return {
      data,
      cost: BigInt(response.headers.get("X-Payment-Amount") || "0"),
      cumulativeSpent: this.consumedAmount,
      receiptSignature:
        response.headers.get("X-Payment-Receipt") || "",
    };
  }

  getUsage(): UsageSnapshot {
    return {
      sessionId: this.channelAdapter.getChannelId(),
      totalCap: this.policy.maxSession,
      consumedAmount: this.consumedAmount,
      remainingAmount: this.policy.maxSession - this.consumedAmount,
      requestCount: this.requestCount,
      status: this.status,
    };
  }

  async settle(): Promise<string> {
    this.status = "SETTLED";
    return this.channelAdapter.closeAndSettle();
  }

  private validateProvider(url: string): void {
    try {
      const provider = new URL(url).hostname;
      if (!this.policy.allowedProviders.has(provider)) {
        throw new Error(`Provider ${provider} is not allowed by policy`);
      }
    } catch (error) {
      throw new Error(
        `Invalid provider URL: ${url}` +
          ((error instanceof Error) ? ` (${error.message})` : ""),
      );
    }
  }

  private isExpired(): boolean {
    if (this.policy.expiryMs <= 0) return false;
    const createdAt = this.channelAdapter.getSessionCreatedAt();
    const elapsed = Date.now() - createdAt;
    return elapsed > this.policy.expiryMs;
  }
}
