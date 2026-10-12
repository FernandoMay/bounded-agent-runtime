# Bounded Agent Runtime

Boundia — agentic payment rail demo for Solana:

- Bounded spend session (cap + expiry). Authorization/settlement shown in the demo UI.
- Agent consumes payment-gated endpoints (MPP/x402 semantics). The hosted Cloudflare Worker implements a demo 402 gateway (synthetic vouchers/receipts) — not a live on-chain verifier in this deployment.
- Provider services gate access through MPP/x402 (demo). Real PayKit/MPP flows live under `apps/research-agent` and `packages/paykit-gateway`.
- Multiple micro-payments aggregate into a Payment Channel settlement (simulated in the hosted dashboard).

## Implemented vs Simulated

- Real (implemented in this repo): PayKit gateway + session client integration (research-agent), MPP client/server patterns, Hyperliquid public REST read (`metaAndAssetCtxs`), Arbitrum JSON-RPC reads (`eth_chainId`, `eth_blockNumber`).
- Read-only real: Hyperliquid and Arbitrum are queried over HTTPS with no transaction signing.
- Fail-closed (real behavior): Zcash — adapter explicitly rejects unsupported phases (no shielded payments implemented).
- Simulated (demo): Cloudflare Worker dashboard settlements use demo references (`sim-demo-*`), synthetic signatures, and random voucher tokens; `helius-zk-proof-verify` returns demo/simulated results.
- Demo gateway: `/api/v1/*` accepts any `Authorization: Bearer ...` for the hosted demo (synthetic). Do not rely on it as a cryptographic MPP/x402 verifier.
- Shared demo state: the hosted dashboard uses a shared D1 instance for demo purposes. Mutating endpoints (`/api/runtime/authorize`, `/api/runtime/revoke`, `/api/runtime/settle`, etc.) may affect a shared demo state; treat as a public demo (not production).

Architecture scope for this repo:

- `@agentic/runtime` — bounded agent economic runtime + policy engine + pay-kit adapter
- `@agentic/provider-middleware` — Express middleware that simulates payment-gated endpoints with 402 / MPP / x402 semantics
- `apps/dashboard` — web UI for authorizing budget and seeing session usage (demo)
- `apps/research-agent` — autonomous research agent demo that consumes paid APIs (real PayKit session flow)

Out of scope / pending:

- Real on-chain settlement verification for the hosted dashboard (separates demo flow from sandbox PayKit flow)
- Voucher/Merchant validation in the Worker gateway
- Strong auth/protection for mutable demo routes
- Expiration/guardrails hardening (concurrency, idempotency, positive duration, quoted-vs-reconciled cost)
- Helius Privacy Devnet funding/shielded balance integration
- Phantom wallet onboarding for the authorization signature
- Subscriptions / Allowances fondear integration
- Reflect idle-capital layer
- FROST multi-agent authorization
