/**
 * Commit 2 runner: real PayKit MPP session flow on the Solana Payment Sandbox.
 *
 * Flow:
 *   fundSandboxAccount()                  — surfnet cheatcodes fund operator+client
 *   createPayKitGateway()                 — provider side: session gate,
 *                                           sessionRoutes mounted explicitly
 *   createSessionFetch() with
 *   createPaymentChannelSessionOpener()   — client side: opens the payment
 *                                           channel & signs cumulative vouchers
 *   3 paid requests under one cap         — real vouchers, real channel
 *   receipt polling                       — on-chain settlement evidence
 *
 * Sandbox: hosted Surfnet (`https://402.surfnet.dev:8899` by default — the
 * environment PayKit's own playground targets; it has the payment-channels
 * program deployed). Override with SANDBOX_RPC_URL.
 */
import {
  createPayKitGateway,
  sandboxRpcUrl,
  fundSandboxAccount,
  captureSessionEvidence,
  type PayKitGateway,
} from "@agentic/paykit-gateway";
import {
  BoundedAgentRuntime,
  PAY_SESSION_GATE_NAME,
  type Policy,
} from "@agentic/runtime";
import {
  createPaymentChannelSessionOpener,
  createSessionFetch,
  type SessionFetchEvent,
} from "@solana/mpp/client";
import { generateKeyPairSigner, type KeyPairSigner } from "@solana/kit";

// ---------------------------------------------------------------------------
// Policy: the bounded economic capability granted to this agent.
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 3001) || 3001;

const policy: Policy = {
  maxSession: 1_000_000n, // base units (USDC, 6 decimals) => $1.00 cap
  expiryMs: 5 * 60 * 1000,
  allowedProviders: new Set([`localhost:${PORT}`]),
};

async function run(): Promise<void> {
  const rpcUrl = sandboxRpcUrl();
  console.log(`Solana Payment Sandbox: ${rpcUrl}`);

  // Operator: fee payer + settlement signer (gateway side).
  const operator: KeyPairSigner = await generateKeyPairSigner();
  // Client: the agent's payer keypair (opens the channel, signs vouchers).
  const client: KeyPairSigner = await generateKeyPairSigner();

  console.log(`Funding operator ${operator.address} and client ${client.address}…`);
  await fundSandboxAccount(rpcUrl, operator.address);
  await fundSandboxAccount(rpcUrl, client.address);

  console.log("Starting PayKit gateway (provider side)…");
  const gateway: PayKitGateway = await createPayKitGateway({
    feePayer: operator,
    recipient: operator.address,
    rpcUrl,
    cap: "1.00",
    unitPrice: "0.0001",
    closeDelayMs: 3000,
  });

  const server = gateway.app.listen(PORT, () => {
    console.log(`PayKit gateway listening on http://localhost:${PORT}`);
  });

  try {
    // Bounded runtime in front of the real PayKit adapter.
    const runtime = new BoundedAgentRuntime(gateway.adapter, policy);

    // ── Policy enforcement check: an over-cap request must fail closed ──
    const brokeRuntime = new BoundedAgentRuntime(gateway.adapter, {
      ...policy,
      maxSession: 1n, // $0.000001 — far below the $0.0001 unit price
    });
    let rejected = false;
    try {
      await brokeRuntime.request(
        `http://localhost:${PORT}/api/v1/session/${PAY_SESSION_GATE_NAME}`,
      );
    } catch (err) {
      rejected = true;
      console.log(
        `Over-cap request correctly rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!rejected) {
      throw new Error("Runtime failed to reject an over-cap request");
    }

    // ── Real session consumption ──
    // Capture native fetch before anything patches globalThis.
    const nativeFetch: typeof globalThis.fetch =
      globalThis.fetch.bind(globalThis);

    let channelId: string | null = null;
    let cumulative = 0n;

    const sessionFetch = createSessionFetch({
      fetch: nativeFetch,
      opener: createPaymentChannelSessionOpener({
        rpcUrl,
        signer: client,
        // Bounded deposit: exactly the session allowance.
        deposit: policy.maxSession,
      }),
      onEvent: (event: SessionFetchEvent) => {
        console.log(`  [session-event] ${event.type}`);
        if (event.type === "open") {
          channelId = event.open.session.channelId;
        }
        if (event.type === "watermark") {
          cumulative = BigInt(event.cumulativeAmount);
        }
      },
    });

    const base = `http://localhost:${PORT}`;
    const paidEndpoint = `/api/v1/session/${PAY_SESSION_GATE_NAME}`;

    // Per-request metered cost: the gateway's unit price, in base units
    // ($0.0001 => 100 USDC micro-units). Each gated response advances the
    // cumulative voucher watermark, which is what the channel settles.
    const UNIT_PRICE_BASE_UNITS = 100n;

    console.log("Consuming session gate 3× via the session client…");
    for (let i = 0; i < 3; i++) {
      const res = await sessionFetch.fetch(`${base}${paidEndpoint}`);
      console.log(`  request ${i + 1}: HTTP ${res.status}`);
      if (res.status !== 200) {
        throw new Error(`Paid request ${i + 1} failed: HTTP ${res.status}`);
      }
      // Meter this delivery: advance the absolute cumulative watermark and
      // commit the voucher immediately so close settles a non-zero amount.
      cumulative += UNIT_PRICE_BASE_UNITS;
      sessionFetch.recordCumulative(cumulative, { force: true });
    }

    // Runtime accounting (the agent's view of its bounded spend).
    const usage = runtime.getUsage();
    console.log("Runtime usage snapshot:");
    console.log(
      JSON.stringify(
        usage,
        (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        2,
      ),
    );

    // ── Settlement evidence: poll the receipt route until idle-close lands ──
    console.log("Polling channel receipt for settlement…");
    let receipt: {
      channelId?: string;
      cumulative?: string;
      deposit?: string;
      sealed?: boolean;
      settledSignature?: string;
    } | null = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const r = await nativeFetch(
        `${base}/sessions/receipt/${channelId ?? ""}`,
      );
      if (r.ok) {
        receipt = await r.json();
        if (receipt?.settledSignature) {
          console.log(
            `Settlement transaction: ${receipt.settledSignature}`,
          );
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log("Receipt:");
    console.log(
      JSON.stringify(
        receipt,
        (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        2,
      ),
    );

    // Evidence from the real SDK: channel, cumulative spend, settlement.
    const evidence = captureSessionEvidence(
      gateway.payKit,
      { url: `${base}${paidEndpoint}` },
      channelId,
      cumulative,
      rpcUrl,
    );
    evidence.receipt = receipt
      ? {
          channelId: receipt.channelId ?? "",
          acceptedCumulative: receipt.cumulative ?? "0",
          spent: receipt.cumulative ?? "0",
          units: null,
        }
      : null;
    evidence.settlementTransaction = receipt?.settledSignature ?? null;
    console.log("Session evidence:");
    console.log(
      JSON.stringify(
        evidence,
        (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        2,
      ),
    );

    if (!evidence.channelOpened) {
      throw new Error("Evidence missing channelId — session did not open");
    }
    if (evidence.cumulativeAmount <= 0n) {
      throw new Error("Evidence missing cumulative spend");
    }
    console.log("\nPASS — real PayKit MPP session verified end-to-end.");
  } finally {
    server.close();
    gateway.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
