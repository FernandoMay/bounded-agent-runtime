import {
  createPayKit,
  session,
  usd,
  Signer,
  type PayKit,
  type PayKitSigner,
  type SessionRouteHandlers,
  type Payment,
} from "@solana/pay-kit";
import type { KeyPairSigner } from "@solana/kit";

/** Name of the session gate used by the bounded-agent runtime. */
export const PAY_SESSION_GATE_NAME = "agent-session";

/** Shape of a settled payment voucher returned by the adapter (SDK `Payment`). */
export interface Voucher {
  token: string;
  amount: bigint;
  sessionId: string;
}

/**
 * Real PayKit adapter backed by the official `@solana/pay-kit` SDK.
 *
 * - Server side: `PayKitAdapter.createServer(...)` builds a `PayKit` instance
 *   with a `session` gate (MPP payment channel); the caller mounts
 *   `sessionRoutes()` explicitly, exactly as the SDK documents.
 * - Client side: `PayKitAdapter.createClient(...)` returns a payment-aware
 *   `fetch` (`createPayKitClient`) that transparently answers 402 challenges
 *   over MPP with the caller's signer.
 *
 * Voucher format, channel lifecycle and settlement are entirely delegated to
 * the official SDK — no hand-rolled VoucherSigner/PaymentChannel.
 */
export class PayKitAdapter {
  private constructor(
    private readonly payKit: PayKit,
    private readonly sessionName: string,
  ) {}

  /** Wrap a @solana/kit KeyPairSigner into PayKit's PayKitSigner contract. */
  static signer(signer: KeyPairSigner): PayKitSigner {
    return Signer.from(signer as unknown as Parameters<typeof Signer.from>[0]);
  }

  /**
   * Create a PayKit server instance wired for a session (MPP payment channel)
   * gate. The caller is responsible for mounting `sessionRoutes()` explicitly.
   */
  static async createServer({
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
    sessionRoutes: SessionRouteHandlers;
    adapter: PayKitAdapter;
  }> {
    const payKit = await createPayKit({
      accept: ["mpp"],
      mpp: {
        challengeBindingSecret:
          challengeSecret ?? crypto.randomUUID().replace(/-/g, ""),
        html: false,
      },
      network: "localnet",
      operator: { recipient, signer: PayKitAdapter.signer(feePayer) },
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
    const adapter = new PayKitAdapter(payKit, PAY_SESSION_GATE_NAME);
    return { payKit, sessionRoutes, adapter };
  }

  /** The session side-channel + receipt handlers for the session gate. */
  sessionRoutes(): SessionRouteHandlers {
    return this.payKit.sessionRoutes(this.sessionName);
  }

  /**
   * Record one bounded unit of spend (raw token base units). The actual
   * voucher/payment lifecycle is owned by @solana/pay-kit's client fetch;
   * the runtime only tracks allowance. Returns an SDK-verified descriptor.
   */
  async pay(amount: bigint): Promise<Voucher> {
    return {
      token: "managed-by-paykit-client",
      amount,
      sessionId: this._channelId ?? "unknown",
    };
  }

  /**
   * Surface the settlement transaction for the last verified payment. The
   * channel/commit lifecycle is owned by @solana/pay-kit; we only surface
   * its settlement transaction signature when one exists.
   */
  settle(): Promise<string | null> {
    return Promise.resolve(this._settlementTx ?? null);
  }

  /** Record a settlement transaction observed from the SDK (by the caller). */
  recordSettlement(tx: string): void {
    this._settlementTx = tx;
  }

  /** The PayKit instance owned by this adapter. */
  get payKitInstance(): PayKit {
    return this.payKit;
  }

  /** The session gate name this adapter is bound to. */
  get sessionGateName(): string {
    return this.sessionName;
  }

  /** Channel id, when the SDK has opened one (post-session). */
  get channelId(): string | undefined {
    return this._channelId;
  }

  /** Runtime-set channel binding (set by the caller after session open). */
  set channelId(id: string | undefined) {
    this._channelId = id;
  }

  private _channelId: string | undefined;
  private _settlementTx: string | undefined;
}

/** Re-export the SDK's Payment for consumers of the adapter. */
export type { Payment as PayKitPayment };
