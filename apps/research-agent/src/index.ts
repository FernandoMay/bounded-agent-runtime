import { BoundedAgentRuntime, PayKitAdapter, type Policy } from "@agentic/runtime";

// Demo-only adapter so the runtime can be exercised without a live chain.
class DemoPayKitAdapter extends PayKitAdapter {
  private createdAt = Date.now();
  private nextVoucher = 1000;

  getChannelId(): string {
    return `channel-demo-${this.createdAt}`;
  }

  getSessionCreatedAt(): number {
    return this.createdAt;
  }

  async signCumulativeVoucher(price: bigint): Promise<{ token: string; amount: bigint; sessionId: string }> {
    this.nextVoucher += Number(price);
    return {
      token: `voucher-${this.nextVoucher}`,
      amount: price,
      sessionId: this.getChannelId(),
    };
  }

  async closeAndSettle(): Promise<string> {
    return `settlement-${this.getChannelId()}-${Date.now()}`;
  }
}

const policy: Policy = {
  maxSession: 10000n,
  expiryMs: 60 * 60 * 1000,
  allowedProviders: new Set(["localhost:3001"]),
};

async function run() {
  const runtime = new BoundedAgentRuntime(new DemoPayKitAdapter(), policy);

  const requests = [
    "http://localhost:3001/weather",
    "http://localhost:3001/market-data?symbol=SOL",
    "http://localhost:3001/inference",
  ];

  console.log("Starting bounded research agent session...");
  console.log(`Channel: ${runtime.sessionId()}`);

  for (const url of requests) {
    try {
      const response = await runtime.request(url, { method: "GET" });
      console.log(JSON.stringify(response, null, 2));
    } catch (error) {
      console.error(`Failed request to ${url}:`, error);
    }
  }

  console.log("Session usage:");
  console.log(JSON.stringify(runtime.getUsage(), null, 2));

  const settlement = await runtime.settle();
  console.log("Settlement:", settlement);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
