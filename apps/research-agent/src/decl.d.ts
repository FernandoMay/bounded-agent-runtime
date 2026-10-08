declare module "@agentic/runtime" {
  import {
    BoundedAgentRuntime,
    PayKitAdapter,
    type Policy,
    type UsageSnapshot,
    type ProviderResponse,
    type Voucher,
  } from "../../packages/runtime/src/index";

  export { BoundedAgentRuntime, PayKitAdapter, type Voucher };
  export type { Policy, UsageSnapshot, ProviderResponse };
}
