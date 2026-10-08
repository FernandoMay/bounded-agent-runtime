import { createPayKit, session, usd, type PayKit } from "@solana/pay-kit";
import { sessionManager } from "mppx/client";
import type { KeyPairSigner } from "@solana/kit";

/**
 * Real PayKit adapter backed by the official SDK.
 *
 * - Server side: `PayKitAdapter.createPayKit(...)` builds a `PayKit` instance
 *   with a `session` gate (MPP payment channel) and returns the `sessionRoutes`
 *   to mount explicitly.
 * - Client side: `PayKitAdapter.openSession(...)` returns a `sessionManager`
 *   configured with the caller's key pair, to open and consume the session.
 *
 * This replaces the demo `DemoPayKitAdapter` (string cosmetics) with a real
 * integration that delegates voucher / channel / settlement to `@solana/pay-kit`
 * + `mppx`.
 */
export class PayKitAdapter {
  constructor(
    private readonly payKit: PayKit,
    private readonly sessionName: string,
  ) {}

  /**
   * Create a PayKit server instance wired for a session (MPP payment channel)
   * gate. The caller is responsible for mounting `sessionRoutes()` explicitly.
   */
  static async createPayKit({
    recipient,
    feePayer,
    rpcUrl,
    cap,
    unitPrice,
    closeDelayMs,
    challengeSecret,
  }: {
    recipient: string;
    feePayer: KeyPairSigner;
    rpcUrl: string;
    cap: string;
    unitPrice: string;
    closeDelayMs?: number;
    challengeSecret?: string;
  }): Promise<{
    payKit: PayKit;
    sessionRoutes: ReturnType<PayKit["sessionRoutes"]>;
  }> {
    const payKit = await createPayKit({
      accept: ["mpp"],
      mpp: {
        challengeBindingSecret:
          challengeSecret ?? crypto.randomUUID().replace(/-/g, ""),
        html: false,
      },
      network: "localnet",
      operator: { recipient, signer: feePayer },
      pricing: {
        [PAY_SESSION_GATE_NAME]: session(usd(cap), {
          unitPrice: usd(unitPrice),
          closeDelayMs: closeDelayMs ?? 5000,
          description: "Bounded agent session (MPP payment channel)",
        }),
      },
      rpcUrl,
    });

    const sessionRoutes = payKit.sessionRoutes(PAY_SESSION_GATE_NAME);
    return { payKit, sessionRoutes };
  }

  /**
   * Return the session side-channel + receipt handlers for the session gate,
   * for the provider to mount explicitly.
   */
  sessionRoutes(): ReturnType<PayKit["sessionRoutes"]> {
    return this.payKit.sessionRoutes(this.sessionName);
  }

  /**
   * Open a session manager for the caller to consume the session gate.
   * The returned manager is configured with the caller's key pair and a
   * local per-session cap via `maxDeposit`.
   */
  openSession(
    account: KeyPairSigner,
    rpcUrl: string,
    maxDeposit: string,
  ): ReturnType<typeof sessionManager> {
    return sessionManager({
      account,
      getClient: undefined,
      maxDeposit,
      rpcUrl,
    });
  }

  /** The PayKit instance owned by this adapter. */
  get payKitInstance(): PayKit {
    return this.payKit;
  }
}

/** Name of the session gate used by the bounded-agent runtime. */
export const PAY_SESSION_GATE_NAME = "agent-session";
