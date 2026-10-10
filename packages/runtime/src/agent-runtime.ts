import { Policy, UsageSnapshot, ProviderResponse } from "./types";
import { PayKitAdapter } from "./paykit-adapter";

export class BoundedAgentRuntime {
  constructor(
    private readonly channelAdapter: PayKitAdapter,
    private readonly policy: Policy,
  ) {}

  private consumedAmount = 0n;
  private requestCount = 0;
  private status: UsageSnapshot["status"] = "ACTIVE";
  private readonly sessionStart: number = Date.now();

  sessionId(): string {
    return `paykit-session:${this.channelAdapter.sessionGateName}`;
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
      const price = this.extractPrice(response);
      if (price === null) {
        throw new Error(
          "Provider returned 402 without a valid payment amount",
        );
      }

      if (this.policy.maxSession - this.consumedAmount < price) {
        this.status = "ERRED";
        throw new Error("Insufficient session allowance for this request");
      }

      const voucher = await this.channelAdapter.pay(price);
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

    const data = await response.json().catch(() => null);
    return {
      data,
      cost: BigInt(response.headers.get("X-Payment-Amount") || "0"),
      cumulativeSpent: this.consumedAmount,
      receiptSignature: response.headers.get("X-Payment-Receipt") || "",
    };
  }

  getUsage(): UsageSnapshot {
    return {
      sessionId: this.sessionId(),
      totalCap: this.policy.maxSession,
      consumedAmount: this.consumedAmount,
      remainingAmount: this.policy.maxSession - this.consumedAmount,
      requestCount: this.requestCount,
      status: this.status,
    };
  }

  /** Close the session and settle the channel via the payment adapter. */
  async settle(): Promise<string | null> {
    if (this.status !== "ACTIVE") return null;
    this.status = "SETTLED";
    return this.channelAdapter.settle();
  }

  /**
   * Extract the requested price (base units) from a 402 response.
   *
   * Checks `X-Payment-Amount` first (x402-style headers), then falls back to
   * the MPP challenge carried in `WWW-Authenticate` — its base64 `request=`
   * parameter holds `{ amount | suggestedDeposit }` in token base units.
   */
  private extractPrice(response: Response): bigint | null {
    const header =
      response.headers.get("X-Payment-Amount") ||
      response.headers.get("x-payment-amount");
    if (header) {
      try {
        const price = BigInt(header);
        return price > 0n ? price : null;
      } catch {
        return null;
      }
    }

    const www = response.headers.get("www-authenticate");
    if (!www) return null;
    const match = www.match(/request="([A-Za-z0-9+/=_-]+)"/);
    if (!match) return null;
    try {
      const json = JSON.parse(atob(match[1])) as {
        amount?: string;
        suggestedDeposit?: string;
      };
      const price = BigInt(json.suggestedDeposit ?? json.amount ?? "0");
      return price > 0n ? price : null;
    } catch {
      return null;
    }
  }

  private validateProvider(url: string): void {
    try {
      const parsed = new URL(url);
      // host = hostname[:port]; policies are written as "localhost:3001".
      const provider = parsed.port ? parsed.host : parsed.hostname;
      if (!this.policy.allowedProviders.has(provider)) {
        throw new Error(`Provider ${provider} is not allowed by policy`);
      }
    } catch (error) {
      throw new Error(
        `Provider not allowed or URL invalid: ${url}` +
          ((error instanceof Error) ? ` (${error.message})` : ""),
      );
    }
  }

  private isExpired(): boolean {
    if (this.policy.expiryMs <= 0) return false;
    const elapsed = Date.now() - this.sessionStart;
    return elapsed > this.policy.expiryMs;
  }
}
