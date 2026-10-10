/**
 * Boundia cross-chain adapter contract.
 *
 * Every chain adapter implements the same five-phase lifecycle:
 *
 *   quote → authorize → execute → confirm → reconcile
 *
 * Authorization is deliberately NOT implemented by adapters: the
 * `PolicyEngine` owns budget, allow-listing and idempotency, and hands each
 * adapter an approved `Authorization` before `execute` runs. Each chain keeps
 * its own signing, balance and confirmation mechanics — the contract only
 * standardizes the *evidence* each phase must produce.
 */

/** The five phases every adapter must implement. */
export type AdapterPhase =
  | "quote"
  | "authorize"
  | "execute"
  | "confirm"
  | "reconcile";

/** What the agent wants to do on a chain. */
export interface Operation {
  /** Operation kind, e.g. "market-data", "chain-state", "payment". */
  readonly kind: string;
  /** Free-form parameters for the adapter. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Client-supplied idempotency key (required by the policy engine). */
  readonly idempotencyKey: string;
}

/** Phase 1 output: what this operation will cost, in chain-native units. */
export interface Quote {
  readonly chain: string;
  readonly operation: string;
  /** Estimated cost in the chain's smallest unit (atomic). */
  readonly estimatedCostAtomic: bigint;
  /** Asset symbol for the cost (e.g. "USDC", "ETH"). */
  readonly asset: string;
  /** Adapter-specific quote details (rates, accounts, calldata size…). */
  readonly details: Readonly<Record<string, unknown>>;
}

/** Phase 2 input: the policy engine's approval for a quote. */
export interface Authorization {
  readonly quote: Quote;
  readonly approvedBy: "policy-engine";
  /** Snapshot of the budget state at approval time. */
  readonly budgetRemainingAtomic: bigint;
}

/** Phase 3 output: the operation was dispatched. */
export interface Execution {
  readonly chain: string;
  /** Chain-native reference (tx signature, RPC batch id, …). */
  readonly reference: string;
  readonly status: "dispatched";
}

/** Phase 4 output: the dispatch was confirmed on the chain / upstream. */
export interface Confirmation {
  readonly chain: string;
  readonly reference: string;
  /** Block number / slot / upstream confirmation id, when applicable. */
  readonly blockRef?: string;
  readonly confirmed: boolean;
}

/** Phase 5 output: settled cost + evidence after confirmation. */
export interface Reconciliation {
  readonly chain: string;
  readonly reference: string;
  readonly settledCostAtomic: bigint;
  /** Verifiable evidence (explorer URL, RPC payload digest, API payload…). */
  readonly evidence: Readonly<Record<string, unknown>>;
}

/**
 * The contract every Boundia adapter implements. Fail-closed: an adapter
 * declaring fewer phases than the operation requires is rejected by the
 * policy engine before anything is dispatched.
 */
export interface ChainAdapter {
  /** Chain identifier, e.g. "solana", "hyperliquid", "arbitrum", "zcash". */
  readonly chain: string;
  /** Phases this adapter can actually perform (honest self-description). */
  readonly capabilities: ReadonlySet<AdapterPhase>;
  /** True only when the adapter can sign/settle on-chain today. */
  readonly settlesOnChain: boolean;

  quote(operation: Operation): Promise<Quote>;
  /** Dispatch an approved quote. Adapters must not bypass the authorization. */
  execute(authorization: Authorization): Promise<Execution>;
  confirm(execution: Execution): Promise<Confirmation>;
  reconcile(
    execution: Execution,
    confirmation: Confirmation,
  ): Promise<Reconciliation>;
}
