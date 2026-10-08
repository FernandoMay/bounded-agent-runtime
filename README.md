# Bounded Agent Runtime

Private agentic payment rail demo for Solana:

- Human authorizes a bounded spend via Solana Allowance
- Agent spends from a private balance using Helius Privacy primitives
- Provider services gate access through MPP/x402
- Multiple micro-payments aggregate into a Payment Channel settlement

Architecture scope for this repo:

- `@agentic/runtime` — bounded agent economic runtime + policy engine + pay-kit adapter
- `@agentic/provider-middleware` — Express middleware that simulates payment-gated endpoints with 402 / MPP / x402 semantics
- `apps/dashboard` — web UI for authorizing budget and seeing session usage
- `apps/research-agent` — autonomous research agent demo that consumes paid APIs

Out of scope for MVP but tracked as P1:

- Helius Privacy Devnet funding/shielded balance integration
- Phantom wallet onboarding for the authorization signature
- Subscriptions / Allowances fondear integration
- Reflect idle-capital layer
- FROST multi-agent authorization
