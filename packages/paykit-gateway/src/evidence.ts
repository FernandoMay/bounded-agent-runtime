/**
 * Evidence captured from a real PayKit session (MPP payment channel) flow.
 *
 * Mirrors the shapes the SDK actually exposes (`Payment`, settlement headers,
 * settlement transaction) — no invented structs.
 */
export interface SessionEvidence {
  /** The session / channel identifier as exposed by the runtime. */
  channelId: string;
  /** Gate name used by the session. */
  gateName: string;
  /** Whether the channel was opened. */
  channelOpened: boolean;
  /** Cumulative amount delivered/accepted by the channel (raw units). */
  cumulativeAmount: bigint;
  /** Settlement transaction signature, when settlement has been produced. */
  settlementTransaction: string | null;
  /** Settlement headers the SDK surfaced on the response. */
  settlementHeaders: Record<string, string>;
  /** PayKit `Payment` object surfaced by the SDK after the session is paid. */
  payment: {
    protocol: string;
    scheme: string;
    gateName: string | undefined;
    payer: string | undefined;
    transaction: string;
    settlementHeaders: Record<string, string>;
  } | null;
  /** Receipt returned by `sessionRoutes.receipt(channelId)` (channel state). */
  receipt: {
    channelId: string;
    acceptedCumulative: string;
    spent: string;
    units: string | null;
  } | null;
  /** Sandbox RPC URL used for the run. */
  rpcUrl: string;
}
