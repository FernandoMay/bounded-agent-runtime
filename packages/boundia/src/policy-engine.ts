/**
 * Boundia policy engine — the common economic layer across chains.
 *
 * Responsibilities (deliberately NOT implemented by adapters):
 *   - per-chain spend budgets (atomic units)
 *   - operation allow-listing per chain
 *   - idempotency keys (one lifecycle per distinct operation attempt)
 *   - an append-only evidence ledger of every authorized lifecycle
 *
 * Fail-closed: any adapter missing a required phase, exceeding its chain
 * budget, or listing an un-allowed operation is rejected before `execute`.
 */
import type {
  AdapterPhase,
  Authorization,
  ChainAdapter,
  Confirmation,
  Execution,
  Operation,
  Quote,
  Reconciliation,
} from "./contract.js";

/** One completed (or failed) lifecycle in the evidence ledger. */
export interface LedgerEntry {
  readonly chain: string;
  readonly operation: string;
  readonly idempotencyKey: string;
  readonly quote: Quote;
  readonly authorization: Authorization;
  readonly execution: Execution | null;
  readonly confirmation: Confirmation | null;
  readonly reconciliation: Reconciliation | null;
  readonly status: "completed" | "failed";
  readonly error?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface PolicyEngineOptions {
  /** Per-chain budgets in that chain's smallest unit (atomic). */
  readonly budgetsAtomic: Readonly<Record<string, bigint>>;
  /** Allowed operation kinds per chain. Unlisted chains allow nothing. */
  readonly allowedOperations: Readonly<Record<string, readonly string[]>>;
}

const REQUIRED_PHASES: readonly AdapterPhase[] = [
  "quote",
  "execute",
  "confirm",
  "reconcile",
];

export class PolicyEngine {
  private readonly spentAtomic = new Map<string, bigint>();
  private readonly seenKeys = new Set<string>();
  private readonly ledger: LedgerEntry[] = [];

  constructor(private readonly options: PolicyEngineOptions) {}

  /**
   * Run one operation through the full lifecycle under policy.
   *
   * @throws when the adapter, operation, budget or idempotency key is not
   *         acceptable — before any dispatch happens.
   */
  async run(
    adapter: ChainAdapter,
    operation: Operation,
  ): Promise<LedgerEntry> {
    const startedAt = new Date().toISOString();

    // ── Static checks: capabilities, allow-list, idempotency ──
    for (const phase of REQUIRED_PHASES) {
      if (!adapter.capabilities.has(phase)) {
        throw new Error(
          `Policy rejected ${adapter.chain}: adapter does not implement phase "${phase}"`,
        );
      }
    }
    const allowed = this.options.allowedOperations[adapter.chain] ?? [];
    if (!allowed.includes(operation.kind)) {
      throw new Error(
        `Policy rejected ${adapter.chain}/${operation.kind}: operation not allow-listed`,
      );
    }
    if (this.seenKeys.has(operation.idempotencyKey)) {
      throw new Error(
        `Policy rejected idempotency key "${operation.idempotencyKey}": already used`,
      );
    }
    this.seenKeys.add(operation.idempotencyKey);

    const budget = this.options.budgetsAtomic[adapter.chain] ?? 0n;
    const spent = this.spentAtomic.get(adapter.chain) ?? 0n;

    let execution: Execution | null = null;
    let confirmation: Confirmation | null = null;
    let reconciliation: Reconciliation | null = null;

    try {
      // ── Phase 1: quote ──
      const quote = await adapter.quote(operation);

      // ── Phase 2: authorize (policy-owned budget check) ──
      const remaining = budget - spent;
      if (quote.estimatedCostAtomic > remaining) {
        throw new Error(
          `Budget exceeded for ${adapter.chain}: need ${quote.estimatedCostAtomic}, ` +
            `remaining ${remaining} (budget ${budget}, spent ${spent})`,
        );
      }
      const authorization: Authorization = {
        quote,
        approvedBy: "policy-engine",
        budgetRemainingAtomic: remaining,
      };

      // ── Phase 3: execute ──
      execution = await adapter.execute(authorization);

      // ── Phase 4: confirm ──
      confirmation = await adapter.confirm(execution);
      if (!confirmation.confirmed) {
        throw new Error(
          `Confirmation failed for ${adapter.chain} ref ${execution.reference}`,
        );
      }

      // ── Phase 5: reconcile + charge the settled cost to the budget ──
      reconciliation = await adapter.reconcile(execution, confirmation);
      this.spentAtomic.set(
        adapter.chain,
        spent + reconciliation.settledCostAtomic,
      );

      const entry: LedgerEntry = {
        chain: adapter.chain,
        operation: operation.kind,
        idempotencyKey: operation.idempotencyKey,
        quote,
        authorization,
        execution,
        confirmation,
        reconciliation,
        status: "completed",
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      this.ledger.push(entry);
      return entry;
    } catch (error) {
      const entry: LedgerEntry = {
        chain: adapter.chain,
        operation: operation.kind,
        idempotencyKey: operation.idempotencyKey,
        quote: {
          chain: adapter.chain,
          operation: operation.kind,
          estimatedCostAtomic: 0n,
          asset: "",
          details: {},
        },
        authorization: {
          quote: {
            chain: adapter.chain,
            operation: operation.kind,
            estimatedCostAtomic: 0n,
            asset: "",
            details: {},
          },
          approvedBy: "policy-engine",
          budgetRemainingAtomic: budget - spent,
        },
        execution,
        confirmation,
        reconciliation,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      this.ledger.push(entry);
      throw error;
    }
  }

  /** Remaining budget for a chain, in atomic units. */
  remaining(chain: string): bigint {
    const budget = this.options.budgetsAtomic[chain] ?? 0n;
    return budget - (this.spentAtomic.get(chain) ?? 0n);
  }

  /** The append-only evidence ledger. */
  entries(): readonly LedgerEntry[] {
    return this.ledger;
  }
}
