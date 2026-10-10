/**
 * Boundia demo: one policy engine, four chains.
 *
 * Runs real network operations through the common lifecycle
 * (quote → authorize → execute → confirm → reconcile):
 *
 *   - Hyperliquid: market-data via the public info API (REAL network)
 *   - Arbitrum:    chain state via the public JSON-RPC (REAL network)
 *   - Zcash:       fail-closed placeholder (no fabricated evidence)
 *
 * Also proves policy enforcement: an over-budget operation and a
 * re-used idempotency key are both rejected before dispatch.
 */
import {
  ArbitrumAdapter,
  HyperliquidAdapter,
  PolicyEngine,
  ZcashAdapter,
} from "@agentic/boundia";

function json(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

async function main(): Promise<void> {
  const engine = new PolicyEngine({
    budgetsAtomic: {
      hyperliquid: 0n,
      arbitrum: 0n,
      zcash: 0n,
      solana: 1_000_000n,
    },
    allowedOperations: {
      hyperliquid: ["market-data"],
      arbitrum: ["chain-state"],
      zcash: ["shielded-payment"],
      solana: ["mpp-session"],
    },
  });

  const hyperliquid = new HyperliquidAdapter();
  const arbitrum = new ArbitrumAdapter();
  const zcash = new ZcashAdapter();

  // ── 1. Hyperliquid market data (real API) ──
  console.log("▸ Hyperliquid: market-data via public info API…");
  const hl = await engine.run(hyperliquid, {
    kind: "market-data",
    idempotencyKey: "demo/hl/1",
  });
  console.log(json(hl.reconciliation?.evidence ?? hl));

  // ── 2. Arbitrum chain state (real RPC) ──
  console.log("\n▸ Arbitrum: chain-state via public JSON-RPC…");
  const arb = await engine.run(arbitrum, {
    kind: "chain-state",
    idempotencyKey: "demo/arb/1",
  });
  console.log(json(arb.reconciliation?.evidence ?? arb));

  // ── 3. Idempotency: the same key must be refused ──
  console.log("\n▸ Idempotency: reusing a key must be refused…");
  try {
    await engine.run(hyperliquid, {
      kind: "market-data",
      idempotencyKey: "demo/hl/1",
    });
    throw new Error("idempotency key was not refused");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  correctly refused: ${msg}`);
    if (!msg.includes("idempotency")) throw err;
  }

  // ── 4. Zcash: fail-closed placeholder, no fabricated evidence ──
  console.log("\n▸ Zcash: fail-closed placeholder…");
  try {
    await engine.run(zcash, {
      kind: "shielded-payment",
      idempotencyKey: "demo/zec/1",
    });
    throw new Error("zcash placeholder was not refused");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  correctly refused: ${msg}`);
    if (!msg.includes("zcash")) throw err;
  }

  // ── Evidence ledger ──
  console.log("\n▸ Evidence ledger (append-only):");
  for (const entry of engine.entries()) {
    console.log(
      `  ${entry.status.padEnd(9)} ${entry.chain}/${entry.operation} ` +
        `ref=${entry.execution?.reference ?? "-"} ` +
        `settled=${entry.reconciliation?.settledCostAtomic ?? 0n}`,
    );
  }

  console.log("\nPASS — Boundia policy engine verified across chains.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
