/**
 * Zcash adapter — privacy surface. HONEST PLACEHOLDER, NOT A MOCK.
 *
 * Zcash needs its own integration: shielded key management, note handling
 * and a protected-transaction flow — it is neither an EVM adapter nor an
 * extension of Solana. Until that integration exists, this adapter declares
 * NO executable capabilities, so the policy engine refuses every operation
 * against it before anything is dispatched. No fabricated evidence is ever
 * produced.
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

const MISSING =
  "Zcash adapter MISSING: requires shielded key management and a " +
  "protected-transaction integration (not implemented; tracked as P1)";

export class ZcashAdapter implements ChainAdapter {
  readonly chain = "zcash";
  readonly capabilities: ReadonlySet<
    "quote" | "authorize" | "execute" | "confirm" | "reconcile"
  > = new Set();
  readonly settlesOnChain = false;

  async quote(_operation: Operation): Promise<Quote> {
    throw new Error(MISSING);
  }

  async execute(_authorization: Authorization): Promise<Execution> {
    throw new Error(MISSING);
  }

  async confirm(_execution: Execution): Promise<Confirmation> {
    throw new Error(MISSING);
  }

  async reconcile(
    _execution: Execution,
    _confirmation: Confirmation,
  ): Promise<Reconciliation> {
    throw new Error(MISSING);
  }
}
