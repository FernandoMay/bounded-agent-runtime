/**
 * Hyperliquid adapter — the agent's financial-market surface.
 *
 * Scope for the hackathon: read-only market data against the public
 * Hyperliquid info API (`POST /info`). This is a REAL network integration
 * (api.hyperliquid.xyz), not a mock; order placement is deliberately not
 * implemented and the adapter's `capabilities` say so honestly — the policy
 * engine refuses any operation whose phases an adapter cannot perform.
 *
 * Costs: public info reads are free (`estimatedCostAtomic = 0n`), so budget
 * enforcement here governs *operation volume* rather than token spend; a
 * paid/market-data-provider adapter would price quotes in USD atomic units.
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

const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";

export interface HyperliquidAssetPrice {
  /** Canonical asset symbol, e.g. "BTC". */
  readonly symbol: string;
  /** Mark price as reported by the exchange, as a decimal string. */
  readonly markPx: string;
}

async function infoPost<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(HYPERLIQUID_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(
      `Hyperliquid info API HTTP ${res.status}: ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

export class HyperliquidAdapter implements ChainAdapter {
  readonly chain = "hyperliquid";
  readonly capabilities: ReadonlySet<
    "quote" | "authorize" | "execute" | "confirm" | "reconcile"
  > = new Set(["quote", "execute", "confirm", "reconcile"]);
  readonly settlesOnChain = false;

  async quote(operation: Operation): Promise<Quote> {
    if (operation.kind !== "market-data") {
      throw new Error(
        `HyperliquidAdapter cannot quote "${operation.kind}"`,
      );
    }
    return {
      chain: this.chain,
      operation: operation.kind,
      estimatedCostAtomic: 0n, // public info endpoint — free
      asset: "USD",
      details: {
        endpoint: HYPERLIQUID_INFO_URL,
        request: { type: "metaAndAssetCtxs" },
      },
    };
  }

  async execute(authorization: Authorization): Promise<Execution> {
    const data = await infoPost<
      [unknown, Array<{ markPx?: string }>, ...unknown[]]
    >({ type: "metaAndAssetCtxs" });
    const payload = JSON.stringify(data);
    return {
      chain: this.chain,
      reference: `hyperliquid:metaAndAssetCtxs:${payload.length}`,
      status: "dispatched",
    };
  }

  async confirm(execution: Execution): Promise<Confirmation> {
    return {
      chain: this.chain,
      reference: execution.reference,
      confirmed: true,
    };
  }

  async reconcile(
    execution: Execution,
    _confirmation: Confirmation,
  ): Promise<Reconciliation> {
    // Fetch once more for the settled snapshot (info API is idempotent reads).
    const [meta, assetCtxs] = await infoPost<
      [{ universe?: Array<{ name: string }> }, Array<{ markPx?: string }>]
    >({ type: "metaAndAssetCtxs" });

    const prices: HyperliquidAssetPrice[] = (meta.universe ?? [])
      .slice(0, 5)
      .map((asset, index) => ({
        symbol: asset.name,
        markPx: String(assetCtxs[index]?.markPx ?? "unknown"),
      }));

    return {
      chain: this.chain,
      reference: execution.reference,
      settledCostAtomic: 0n,
      evidence: {
        endpoint: HYPERLIQUID_INFO_URL,
        observedAt: new Date().toISOString(),
        universeSize: meta.universe?.length ?? 0,
        topAssets: prices,
      },
    };
  }
}
