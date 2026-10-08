/**
 * Integration runner for Commit 2 (real PayKit MPP session).
 *
 * Boots a Surfpool (Surfnet) sandbox, creates a PayKit gateway with a session
 * gate, opens a client MPP session from the research-agent, consumes the session
 * gate a few times, and captures `SessionEvidence` — real channel / voucher /
 * cumulative / settlement / receipt data from the SDK, no invented structs.
 */
import express from "express";
import { startSandbox, type SurfnetSandbox } from "@agentic/paykit-gateway";
import { createPayKitGateway, type PayKitGateway, captureSessionEvidence } from "@agentic/paykit-gateway";
import { PAY_SESSION_GATE_NAME } from "@agentic/runtime";
import { sessionManager } from "mppx/client";
import { create } from "mppx/client";

/**
 * Run the real PayKit MPP session flow and return the evidence captured.
 */
export async function runPayKitSessionFlow(): Promise<{
  sandbox: SurfnetSandbox;
  gateway: PayKitGateway;
  evidence: ReturnType<typeof captureSessionEvidence>;
  closeGateway: () => void;
}> {
  // 1. Sandbox: Surfpool (Surfnet) local, deterministic, no real cost.
  const sandbox = await startSandbox();
  const feePayer = sandbox.operator;
  const client = sandbox.client;
  const rpcUrl = sandbox.rpcUrl;

  // 2. Provider: real PayKit gateway with a session gate.
  const gateway = await createPayKitGateway({
    feePayer,
    recipient: feePayer.address,
    rpcUrl,
    cap: "1.00",
    unitPrice: "0.0001",
  });

  // Start the HTTP server so the client can reach it.
  const PORT = Number(process.env.PORT ?? 3001) || 3001;
  const server = gateway.app.listen(PORT, () => {
    console.log(`PayKit gateway listening on http://localhost:${PORT}`);
  });

  const closeGateway = () => {
    server.close();
    gateway.close();
  };

  // 3. Client: real MPP session manager from the research-agent, with a
  //    per-session cap via maxDeposit.
  const clientSession = sessionManager({
    account: client,
    getClient: undefined,
    maxDeposit: "1.00",
    rpcUrl,
  });

  // 4. Consume the session gate via the client's fetch (mppx handles 402 +
  //    session open + voucher delivery automatically).
  const mppx = create({
    methods: [clientSession],
    fetch: globalThis.fetch,
  });

  const baseUrl = `http://localhost:${PORT}`;
  const paidEndpoint = `/api/v1/session/${PAY_SESSION_GATE_NAME}`;

  await mppx.fetch(`${baseUrl}${paidEndpoint}`);
  await mppx.fetch(`${baseUrl}${paidEndpoint}`);
  await mppx.fetch(`${baseUrl}${paidEndpoint}`);

  // 5. Capture evidence from the SDK (channel, voucher, cumulative, receipt,
  //    settlement) — real shapes, no invented structs.
  const payKit = gateway.payKit;
  const request = { url: `${baseUrl}${paidEndpoint}` } as express.Request;
  const evidence = captureSessionEvidence(
    payKit,
    request,
    /* channelId */ (clientSession as any).runtime?.channel?.channelId ?? null,
    /* cumulativeAmount */ (clientSession as any).runtime?.channel?.cumulativeAmount ?? 0n,
    /* settlementTransaction */ payKit.payment(request)?.transaction ?? null,
    /* settlementHeaders */ payKit.payment(request)?.settlementHeaders ?? {},
  );

  return { sandbox, gateway, evidence, closeGateway };
}

