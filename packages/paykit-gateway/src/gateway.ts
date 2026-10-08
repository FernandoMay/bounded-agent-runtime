import express, { type Request, type Response } from "express";
import { createPayKit, session, usd, type PayKit } from "@solana/pay-kit";
import type { KeyPairSigner } from "@solana/kit";
import { PAY_SESSION_GATE_NAME } from "@agentic/runtime/paykit-adapter";
import { type SessionEvidence } from "./evidence.js";

/**
 * Options for creating a PayKit gateway (Express server) with a session gate.
 */
export interface PayKitGatewayOptions {
  /** Fee-payer + settlement signer (operator). */
  feePayer: KeyPairSigner;
  /** Recipient (the address that receives the session payments). */
  recipient: string;
  /** RPC URL of the sandbox / network. */
  rpcUrl: string;
  /** Session cap (human-readable currency amount, e.g. "1.00"). */
  cap?: string;
  /** Per-delivery unit price (human-readable currency amount, e.g. "0.0001"). */
  unitPrice?: string;
  /** Optional challenge secret (if omitted, one is generated per boot). */
  challengeSecret?: string;
  /** Optional close delay (ms) for idle-close. Defaults to 5000. */
  closeDelayMs?: number;
}

/** A running PayKit gateway (Express server) with a session gate mounted. */
export interface PayKitGateway {
  /** The Express app (so callers can add more routes or start listening). */
  app: express.Application;
  /** The PayKit instance owned by the gateway. */
  payKit: PayKit;
  /** The session side-channel + receipt handlers for the session gate. */
  sessionRoutes: ReturnType<PayKit["sessionRoutes"]>;
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
 * This is the real provider side of Commit 2: it delegates voucher / channel /
 * settlement to `@solana/pay-kit` and does NOT implement any manual
 * `VoucherSigner` / `PaymentChannel` / `SettlementEngine`.
 */
export async function createPayKitGateway(opts: PayKitGatewayOptions): Promise<PayKitGateway> {
  const cap = opts.cap ?? "1.00";
  const unitPrice = opts.unitPrice ?? "0.0001";
  const closeDelayMs = opts.closeDelayMs ?? 5000;

  const payKit = await createPayKit({
    accept: ["mpp"],
    mpp: {
      challengeBindingSecret:
        opts.challengeSecret ?? crypto.randomUUID().replace(/-/g, ""),
      html: false,
    },
    network: "localnet",
    operator: { recipient: opts.recipient, signer: opts.feePayer },
    pricing: {
      [PAY_SESSION_GATE_NAME]: session(usd(cap), {
        unitPrice: usd(unitPrice),
        closeDelayMs,
        description: "Bounded agent session (MPP payment channel)",
      }),
    },
    rpcUrl: opts.rpcUrl,
  });

  const sessionRoutes = payKit.sessionRoutes(PAY_SESSION_GATE_NAME);

  const app = express();
  app.use(express.json());

  // Session gate: the paid endpoint the agent consumes.
  app.get(
    `/api/v1/session/${PAY_SESSION_GATE_NAME}`,
    payKit.express(PAY_SESSION_GATE_NAME),
    (_req: Request, res: Response) => {
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
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, gate: PAY_SESSION_GATE_NAME, cap, unitPrice, rpcUrl: opts.rpcUrl });
  });

  let server: ReturnType<express.Application["listen"]> | null = null;
  return {
    app,
    payKit,
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
 * Capture session evidence from a PayKit payment on a request.
 *
 * This is the evidence the runtime surfaces after the agent consumes a session.
 * It mirrors the shapes the SDK actually exposes (no invented structs).
 */
export function captureSessionEvidence(
  payKit: PayKit,
  request: express.Request,
  channelId: string | null,
  cumulativeAmount: bigint,
  settlementTransaction: string | null,
  settlementHeaders: Record<string, string>,
): SessionEvidence {
  const payment = payKit.payment(request);
  return {
    channelId: channelId ?? "",
    gateName: PAY_SESSION_GATE_NAME,
    cap: "",
    unitPrice: "",
    channelOpened: channelId != null && channelId.length > 0,
    cumulativeAmount,
    settlementTransaction,
    settlementHeaders,
    payment: payment
      ? {
          protocol: payment.protocol,
          scheme: payment.scheme,
          gateName: payment.gateName,
          payer: payment.payer,
          transaction: payment.transaction,
          settlementHeaders: payment.settlementHeaders,
        }
      : null,
    receipt: null,
    rpcUrl: "",
  };
}
