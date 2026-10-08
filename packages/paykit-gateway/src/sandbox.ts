import { Surfnet } from "surfpool-sdk";
import type { KeyPairSigner } from "@solana/kit";
import { createKeyPairSignerFromBytes, getBase58Encoder, type KeypairInfo } from "@solana/kit";
import { Buffer } from "node:buffer";

/**
 * A running Surfpool (Surfnet) sandbox instance, with RPC URL and pre-funded
 * keypairs for the operator (fee payer / settlement signer) and the client
 * wallet.
 */
export interface SurfnetSandbox {
  /** The Surfnet runtime instance. */
  surfnet: Surfnet;
  /** HTTP RPC URL of the sandbox. */
  rpcUrl: string;
  /** Operator (fee payer + settlement signer) as a `KeyPairSigner`. */
  operator: KeyPairSigner;
  /** Client wallet (the agent/session opener) as a `KeyPairSigner`. */
  client: KeyPairSigner;
}

/**
 * Start a Surfpool sandbox (offline, tx-mode blocks, pre-funded payer),
 * fund the operator + client with SOL and USDC, and return the sandbox handle.
 *
 * This is the deterministic sandbox we use for Commit 2 evidence. It runs
 * entirely locally and costs nothing on real networks.
 */
export async function startSandbox(): Promise<SurfnetSandbox> {
  const surfnet = Surfnet.start();

  // Operator: fee payer + settlement signer.
  const operator = await createKeyPairSignerFromBytes(
    getBase58Encoder().encode(Buffer.from(surfnet.payerSecretKey)),
  );

  // Client wallet: the agent / session opener.
  const clientKeypair: KeypairInfo = Surfnet.newKeypair();
  const client = await createKeyPairSignerFromBytes(
    getBase58Encoder().encode(Buffer.from(clientKeypair.secretKey).toString("base64")),
  );

  // Fund both with SOL (lamports) and USDC (tokens) so they can pay/settle.
  // USDC mint on the sandbox uses the mainnet mint (sandbox clones mainnet state).
  surfnet.fundSol(operator.address, 100_000_000_000); // 100 SOL
  surfnet.fundSol(client.address, 10_000_000_000); // 10 SOL
  surfnet.fundTokenMany([operator.address, client.address], USDC_MINT, 1_000_000); // 1 USDC ea

  return {
    surfnet,
    rpcUrl: surfnet.rpcUrl,
    operator,
    client,
  };
}

/** USDC mint as resolved by the SDK for mainnet (used by the sandbox). */
const USDC_MINT = "EPjFWddVKzSbQv33FaM9uHVxFdUBa4XSSfmK24oddKo";
