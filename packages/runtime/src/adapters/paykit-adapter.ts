export interface Voucher {
  token: string;
  amount: bigint;
  sessionId: string;
}

export abstract class PayKitAdapter {
  abstract getChannelId(): string;
  abstract getSessionCreatedAt(): number;
  abstract signCumulativeVoucher(price: bigint): Promise<Voucher>;
  abstract closeAndSettle(): Promise<string>;
}
