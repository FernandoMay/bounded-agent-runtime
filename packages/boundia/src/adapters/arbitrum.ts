/**
 * Arbitrum adapter — the agent's EVM surface.
 *
 * Scope for the hackathon: read-only chain state against the public Arbitrum
 * One JSON-RPC (`https://arb1.arbitrum.io/rpc`). This is a REAL network
 * integration (eth_chainId / eth_blockNumber / eth_getBalance / eth_call);
 * transaction sending is deliberately not implemented and the adapter says so
 * via `capabilities` — the policy engine refuses phases it cannot perform.
 *
 * Costs: RPC reads are free (`estimatedCostAtomic = 0n`); the budget still
 * governs operation volume and would govern real gas costs once execute
 * gains a funded signer.
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

const ARBITRUM_RPC_URL =
  process.env.ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc";

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

let rpcId = 0;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(ARBITRUM_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method,
      params,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Arbitrum RPC HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as JsonRpcResponse<T>;
  if (body.error) {
    throw new Error(`Arbitrum RPC ${method}: ${body.error.message}`);
  }
  if (body.result === undefined) {
    throw new Error(`Arbitrum RPC ${method}: missing result`);
  }
  return body.result;
}

export class ArbitrumAdapter implements ChainAdapter {
  readonly chain = "arbitrum";
  readonly capabilities: ReadonlySet<
    "quote" | "authorize" | "execute" | "confirm" | "reconcile"
  > = new Set(["quote", "execute", "confirm", "reconcile"]);
  readonly settlesOnChain = false;

  async quote(operation: Operation): Promise<Quote> {
    if (operation.kind !== "chain-state") {
      throw new Error(`ArbitrumAdapter cannot quote "${operation.kind}"`);
    }
    return {
      chain: this.chain,
      operation: operation.kind,
      estimatedCostAtomic: 0n, // JSON-RPC reads are free
      asset: "ETH",
      details: { rpcUrl: ARBITRUM_RPC_URL, methods: [
        "eth_chainId",
        "eth_blockNumber",
        "eth_getBalance",
      ] },
    };
  }

  async execute(authorization: Authorization): Promise<Execution> {
    const chainId = await rpc<string>("eth_chainId", []);
    const blockNumber = await rpc<string>("eth_blockNumber", []);
    const balance = await rpc<string>("eth_getBalance", [
      "0x0000000000000000000000000000000000000000",
      "latest",
    ]);
    // Stash the reads on the reference; reconcile re-reads for evidence.
    const reference = `arbitrum:${parseInt(chainId, 16)}:${parseInt(blockNumber, 16)}`;
    (this as unknown as { lastRead?: { chainId: string; blockNumber: string; balance: string } })
      .lastRead = { chainId, blockNumber, balance };
    return { chain: this.chain, reference, status: "dispatched" };
  }

  async confirm(execution: Execution): Promise<Confirmation> {
    const blockNumber = await rpc<string>("eth_blockNumber", []);
    return {
      chain: this.chain,
      reference: execution.reference,
      blockRef: String(parseInt(blockNumber, 16)),
      confirmed: parseInt(blockNumber, 16) > 0,
    };
  }

  async reconcile(
    execution: Execution,
    confirmation: Confirmation,
  ): Promise<Reconciliation> {
    const lastRead = (
      this as unknown as {
        lastRead?: { chainId: string; blockNumber: string; balance: string };
      }
    ).lastRead;
    return {
      chain: this.chain,
      reference: execution.reference,
      settledCostAtomic: 0n,
      evidence: {
        rpcUrl: ARBITRUM_RPC_URL,
        observedAt: new Date().toISOString(),
        chainIdHex: lastRead?.chainId ?? null,
        blockNumberHex: lastRead?.blockNumber ?? null,
        zeroAddressBalanceWei: lastRead?.balance ?? null,
        confirmedBlock: confirmation.blockRef ?? null,
      },
    };
  }
}
