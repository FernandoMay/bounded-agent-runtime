import { Surfnet } from "surfpool-sdk";
const SurfnetClass = Surfnet;
import { createKeyPairSignerFromBytes } from "@solana/kit";

/** Default hosted Solana Payment Sandbox (clones mainnet state). */
export const DEFAULT_SANDBOX_RPC_URL = "https://402.surfnet.dev:8899";

/** Mainnet USDC mint — the hosted sandbox clones mainnet state. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SOL_FUND_LAMPORTS = 100_000_000_000; // 100 SOL
const USDC_FUND_AMOUNT = 100_000_000; // 100 USDC (6 decimals)

/**
 * RPC URL of the Solana Payment Sandbox.
 *
 * `SANDBOX_RPC_URL` overrides; defaults to the hosted Surfnet sandbox, which
 * is the environment PayKit's own playground targets. The payment-channels
 * program (`CHNLx…`) is deployed there; a plain local validator does not have
 * it, so session flows must run against this sandbox (or a Surfnet instance
 * with the program deployed).
 */
export function sandboxRpcUrl(): string {
  return process.env.SANDBOX_RPC_URL ?? DEFAULT_SANDBOX_RPC_URL;
}

/** Minimal JSON-RPC 2.0 call for the surfnet cheatcode methods. */
async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json()) as { error?: { message: string }; result?: unknown };
  if (data.error) throw new Error(`${method}: ${data.error.message}`);
  return data.result;
}

/** Fund an address with SOL on the hosted sandbox (surfnet cheatcode). */
export async function fundSol(rpcUrl: string, address: string): Promise<void> {
  await rpcCall(rpcUrl, "surfnet_setAccount", [
    address,
    {
      lamports: SOL_FUND_LAMPORTS,
      data: "",
      executable: false,
      owner: SYSTEM_PROGRAM,
      rentEpoch: 0,
    },
  ]);
}

/** Fund an address's USDC ATA on the hosted sandbox (surfnet cheatcode). */
export async function fundUsdc(rpcUrl: string, address: string): Promise<void> {
  await rpcCall(rpcUrl, "surfnet_setTokenAccount", [
    address,
    USDC_MINT,
    { amount: USDC_FUND_AMOUNT, state: "initialized" },
    TOKEN_PROGRAM,
  ]);
}

/** Fund an address with SOL + USDC on the hosted sandbox. */
export async function fundSandboxAccount(
  rpcUrl: string,
  address: string,
): Promise<void> {
  await fundSol(rpcUrl, address);
  await fundUsdc(rpcUrl, address);
}

/**
 * A running Surfpool (Surfnet) sandbox instance, with RPC URL and pre-funded
 * keypairs for the operator (fee payer / settlement signer) and the client
 * wallet. This boots an embedded local Surfnet via surfpool-sdk; note that
 * session flows need the payment-channels program (use the hosted sandbox).
 */
export interface SurfnetSandbox {
  /** The Surfnet runtime instance. */
  surfnet: Surfnet;
  /** HTTP RPC URL of the sandbox. */
  rpcUrl: string;
  /** Operator (fee payer + settlement signer) as a `KeyPairSigner`. */
  operator: import("@solana/kit").KeyPairSigner;
  /** Client wallet (the agent/session opener) as a `KeyPairSigner`. */
  client: import("@solana/kit").KeyPairSigner;
}

/** Convert a secret key of unknown type into a Uint8Array. */
function toUint8ArraySecretKey(sk: unknown): Uint8Array {
  if (sk instanceof Uint8Array) return sk;
  return new Uint8Array(sk as readonly number[]);
}

/**
 * Start an embedded Surfpool sandbox (offline, tx-mode blocks, pre-funded
 * payer) and fund the operator + client with SOL and USDC.
 */
export async function startSandbox(): Promise<SurfnetSandbox> {
  const surfnet = Surfnet.start();

  const operator = await createKeyPairSignerFromBytes(surfnet.payerSecretKey);

  const clientKeypair = SurfnetClass.newKeypair();
  const clientSecretKey = toUint8ArraySecretKey(clientKeypair.secretKey);
  const client = await createKeyPairSignerFromBytes(clientSecretKey);

  surfnet.fundSol(operator.address, 100_000_000_000);
  surfnet.fundSol(client.address, 10_000_000_000);
  surfnet.fundTokenMany([operator.address, client.address], USDC_MINT, 1_000_000);

  return {
    surfnet,
    rpcUrl: surfnet.rpcUrl,
    operator,
    client,
  };
}
