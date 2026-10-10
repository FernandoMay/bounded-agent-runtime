/**
 * Solana adapter — bridges Boundia's five-phase contract to the existing
 * `@agentic/runtime` PayKit flow (MPP session + payment channel on the
 * Solana Payment Sandbox).
 *
 * The heavy lifting already lives in `apps/research-agent/src/index.ts`
 * (createSessionFetch + createPaymentChannelSessionOpener). This adapter
 * wraps that flow so the policy engine can treat Solana like every other
 * chain: quote the session cap, authorize under budget, execute paid
 * requests, confirm settlement, reconcile with the on-chain signature.
 */
import type {
  Authorization,
  ChainAdapter,
  Confirmation,
  Execution,
  Operation,
  Quote,
  Reconciliation,
} from "../contract.js";

/** The pieces of a completed PayKit session this adapter consumes. */
export interface SolanaSessionOutcome {
  readonly channelId: string;
  readonly cumulativeBaseUnits: bigint;
  readonly settledSignature: string | null;
  readonly unitPriceBaseUnits: bigint;
}

export class SolanaPayKitAdapter implements ChainAdapter {
  readonly chain = "solana";
  readonly capabilities: ReadonlySet<
    "quote" | "authorize" | "execute" | "confirm" | "reconcile"
  > = new Set(["quote", "execute", "confirm", "reconcile"]);
  readonly settlesOnChain = true;

  private outcome: SolanaSessionOutcome | null = null;

  constructor(
    /** Runs the real PayKit session flow; returns settled evidence. */
    private readonly runSession: (
      operation: Operation,
      maxSpendBaseUnits: bigint,
    ) => Promise<SolanaSessionOutcome>,
    /** Session cap quoted per operation, in USDC base units. */
    private readonly capBaseUnits: bigint,
  ) {}

  async quote(operation: Operation): Promise<Quote> {
    if (operation.kind !== "mpp-session") {
      throw new Error(`SolanaPayKitAdapter cannot quote "${operation.kind}"`);
    }
    return {
      chain: this.chain,
      operation: operation.kind,
      estimatedCostAtomic: this.capBaseUnits,
      asset: "USDC",
      details: {
        protocol: "MPP session (payment channel)",
        sandbox: process.env.SANDBOX_RPC_URL ?? "https://402.surfnet.dev:8899",
      },
    };
  }

  async execute(authorization: Authorization): Promise<Execution> {
    this.outcome = await this.runSession(
      { kind: "mpp-session", idempotencyKey: "solana-session" },
      authorization.quote.estimatedCostAtomic,
    );
    return {
      chain: this.chain,
      reference: `solana:${this.outcome.channelId}`,
      status: "dispatched",
    };
  }

  async confirm(execution: Execution): Promise<Confirmation> {
    return {
      chain: this.chain,
      reference: execution.reference,
      blockRef: this.outcome?.settledSignature ?? undefined,
      confirmed: this.outcome?.channelId != null,
    };
  }

  async reconcile(
    execution: Execution,
    _confirmation: Confirmation,
  ): Promise<Reconciliation> {
    const outcome = this.outcome;
    if (!outcome) {
      throw new Error("SolanaPayKitAdapter: nothing to reconcile");
    }
    return {
      chain: this.chain,
      reference: execution.reference,
      settledCostAtomic: outcome.cumulativeBaseUnits,
      evidence: {
        channelId: outcome.channelId,
        cumulativeBaseUnits: outcome.cumulativeBaseUnits.toString(),
        settlementSignature: outcome.settledSignature,
        settlesOnChain: true,
      },
    };
  }
}
