/**
 * Evidence captured from a real PayKit session (MPP payment channel) flow.
 *
 * This is the evidence structure we want to surface from the runtime after a
 * session is opened, consumed, and settled. It is *not* invented — it mirrors
 * the shapes the SDK actually exposes (`Payment`, receipt headers, settlement
 * transaction, `sessionRoutes.receipt()` channel state).
 */
export interface SessionEvidence {
  /** The session / channel identifier as exposed by the SDK. */
  channelId: string;
  /** Gate name used by the session. */
  gateName: string;
  /** Cap authorized for the session (human-readable currency amount). */
  cap: string;
  /** Per-delivery unit price (human-readable currency amount). */
  unitPrice: string;
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
