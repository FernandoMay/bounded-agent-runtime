import type { PayKit } from "@solana/pay-kit";
import type { KeyPairSigner } from "@solana/kit";
import { PayKitAdapter, PAY_SESSION_GATE_NAME, type PayKitPayment } from "@agentic/runtime";
import { type SessionEvidence } from "./evidence.js";

/**
 * Options for creating a PayKit gateway (Express server) with a session gate.
 */
export interface PayKitGatewayOptions {
  /** Fee-payer + settlement signer (operator), as a @solana/kit KeyPairSigner. */
  feePayer: KeyPairSigner;
  /** Recipient (the address that receives the session payments). */
  recipient: string;
  /** RPC URL of the sandbox / network. */
  rpcUrl: string;
  /** Session cap (human-readable USD amount, e.g. "1.00"). */
  cap?: string;
  /** Per-delivery unit price (human-readable USD amount, e.g. "0.0001"). */
  unitPrice?: string;
  /** Optional challenge secret (if omitted, one is generated per boot). */
  challengeSecret?: string;
  /** Optional close delay (ms) for idle-close. Defaults to 5000. */
  closeDelayMs?: number;
}

/** A running PayKit gateway (Express server) with a session gate mounted. */
export interface PayKitGateway {
  /** The Express app (so callers can add more routes or start listening). */
  app: import("express").Application;
  /** The PayKit instance owned by the gateway. */
  payKit: PayKit;
  /** The runtime adapter wrapping the gateway's PayKit instance. */
  adapter: PayKitAdapter;
  /** The session side-channel + receipt handlers for the session gate. */
  sessionRoutes: import("@solana/pay-kit").SessionRouteHandlers;
  /** Human-readable cap configured for the session. */
  cap: string;
  /** Human-readable unit price configured for the session. */
  unitPrice: string;
  /** RPC URL the gateway is talking to. */
  rpcUrl: string;
  /** Stop the HTTP server if it was started. */
  close: () => void;
}

/**
 * Create a PayKit gateway (Express server) with a session (MPP payment channel)
 * gate, and mount the session side-channel + receipt routes explicitly.
 *
 * This is the real provider side of Commit 2: voucher / channel / settlement
 * are delegated entirely to `@solana/pay-kit`; this package only wires Express
 * routes around the SDK handlers.
 */
export async function createPayKitGateway(
  opts: PayKitGatewayOptions,
): Promise<PayKitGateway> {
  const express = await import("express");
  const app = express.default();
  app.use(express.default.json());

  const { payKit, sessionRoutes, adapter } = await PayKitAdapter.createServer({
    recipient: opts.recipient,
    feePayer: opts.feePayer,
    rpcUrl: opts.rpcUrl,
    cap: opts.cap ?? "1.00",
    unitPrice: opts.unitPrice ?? "0.0001",
    closeDelayMs: opts.closeDelayMs,
    challengeSecret: opts.challengeSecret,
  });

  const cap = opts.cap ?? "1.00";
  const unitPrice = opts.unitPrice ?? "0.0001";

  // Session gate: the paid endpoint the agent consumes.
  app.get(
    `/api/v1/session/${PAY_SESSION_GATE_NAME}`,
    payKit.express(PAY_SESSION_GATE_NAME),
    (_req: import("express").Request, res: import("express").Response) => {
      res.json({ ok: true, gate: PAY_SESSION_GATE_NAME });
    },
  );

  // Session side-channel + receipt routes — mounted explicitly (PayKit leaves
  // route mounting to the app, consistent with mppx).
  app.post(`/api/v1/session/${PAY_SESSION_GATE_NAME}`, sessionRoutes.voucher);
  app.post("/__402/session/deliveries", sessionRoutes.deliveries);
  app.post("/__402/session/commit", sessionRoutes.commit);
  app.get("/sessions/receipt/:channelId", sessionRoutes.receipt);

  // Health + config (so clients can discover the gateway + sandbox).
  app.get("/health", (_req: import("express").Request, res: import("express").Response) => {
    res.json({
      ok: true,
      gate: PAY_SESSION_GATE_NAME,
      cap,
      unitPrice,
      rpcUrl: opts.rpcUrl,
    });
  });

  let server: ReturnType<import("express").Application["listen"]> | null = null;
  return {
    app,
    payKit,
    adapter,
    sessionRoutes,
    cap,
    unitPrice,
    rpcUrl: opts.rpcUrl,
    close() {
      server?.close();
      server = null;
    },
  };
}

/**
 * Capture session evidence from a real PayKit payment.
 *
 * Mirrors the shapes the SDK actually exposes (`Payment`, settlement headers,
 * settlement transaction) — no invented structs.
 */
export function captureSessionEvidence(
  payKit: PayKit,
  request: object,
  channelId: string | null,
  cumulativeAmount: bigint,
  rpcUrl: string,
): SessionEvidence {
  const payment: PayKitPayment | undefined = payKit.payment(request);
  return {
    channelId: channelId ?? "",
    gateName: PAY_SESSION_GATE_NAME,
    channelOpened: channelId != null && channelId.length > 0,
    cumulativeAmount,
    settlementTransaction: payment?.transaction ?? null,
    settlementHeaders: payment?.settlementHeaders
      ? { ...payment.settlementHeaders }
      : {},
    payment: payment
      ? {
          protocol: payment.protocol,
          scheme: payment.scheme,
          gateName: payment.gateName,
          payer: payment.payer,
          transaction: payment.transaction,
          settlementHeaders: { ...payment.settlementHeaders },
        }
      : null,
    receipt: null,
    rpcUrl,
  };
}
