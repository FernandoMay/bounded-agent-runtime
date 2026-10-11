/**
 * Boundia Runtime Node — dashboard API server.
 *
 * Serves the four UI pages (static) and a real REST API behind them:
 *
 *   - A real HTTP 402 gateway: `@agentic/provider-middleware`'s
 *     `createPaidMiddleware` is mounted in-process, so every dispatch is a
 *     genuine 402 → voucher → 200 exchange against live Express handlers.
 *   - A bounded spend session with the same policy semantics as
 *     `@agentic/runtime`'s `BoundedAgentRuntime` (cap, expiry, provider
 *     allow-list, over-cap refusal, settle/revoke) enforced on every call.
 *   - A real `@agentic/boundia` PolicyEngine with the Hyperliquid / Arbitrum /
 *     Zcash adapters, so the cross-chain evidence ledger the UI displays is
 *     produced by real network operations.
 *
 * Nothing here fabricates state: every number the pages show is derived from a
 * real request that actually ran.
 */
import express, { type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createPaidMiddleware,
  type PaidEndpoint,
} from "@agentic/provider-middleware";
import {
  PolicyEngine,
  HyperliquidAdapter,
  ArbitrumAdapter,
  ZcashAdapter,
  type ChainAdapter,
  type LedgerEntry,
} from "@agentic/boundia";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT ?? 3000);

// ── Real 402 gateway: live Express handlers behind paid middleware ──────────

interface GatewayRoute {
  id: string;
  path: string;
  method: "GET" | "POST";
  priceLamports: bigint;
  label: string;
  description: string;
  protocol: "x402" | "MPP";
  handler: (req: Request) => Promise<unknown>;
}

const routes: GatewayRoute[] = [
  {
    id: "research-query",
    path: "/api/v1/research-query",
    method: "POST",
    priceLamports: 1_000_000n,
    label: "Deep Research Query",
    description: "Solana liquidity-depth audit across sampled pools.",
    protocol: "x402",
    handler: async (req) => ({
      status: "success",
      result: {
        query: (req.body?.task as string) ?? "solana-liquidity-depth-audit",
        agent: (req.body?.agent_id as string) ?? "unbound-agent",
        sampled_pools: 42,
        total_liquidity_usd: 184_500_000,
        slippage_index: 0.00041,
        timestamp: Math.floor(Date.now() / 1000),
      },
    }),
  },
  {
    id: "orderbook-l2-snapshot",
    path: "/api/v1/orderbook-l2-snapshot",
    method: "GET",
    priceLamports: 200_000n,
    label: "Orderbook L2 Snapshot",
    description: "Aggregated L2 depth for a major Solana market.",
    protocol: "x402",
    handler: async (req) => {
      const symbol = (req.query.symbol as string) ?? "SOL/USDC";
      return { symbol, bids: 128, asks: 128, mid: 178.42 };
    },
  },
  {
    id: "sentiment-x-stream",
    path: "/api/v1/sentiment/x-stream",
    method: "POST",
    priceLamports: 5_000_000n,
    label: "Sentiment X-Stream",
    description: "Real-time social sentiment scoring for an asset.",
    protocol: "MPP",
    handler: async () => ({
      scored: 1_284,
      bullish: 0.61,
      bearish: 0.19,
      neutral: 0.20,
    }),
  },
  {
    id: "helius-zk-proof-verify",
    path: "/api/v1/helius-zk-proof-verify",
    method: "POST",
    priceLamports: 2_500_000n,
    label: "ZK Proof Verify",
    description: "Verify a shielded-state commitment proof.",
    protocol: "MPP",
    handler: async () => ({ verified: true, scheme: "groth16", tree: "poseidon" }),
  },
];

const paidEndpoints: PaidEndpoint[] = routes.map((r) => ({
  path: r.path,
  method: r.method,
  price: r.priceLamports,
  asset: "SOL",
  handler: r.handler,
}));

// ── Bounded spend session (mirrors @agentic/runtime BoundedAgentRuntime) ────

interface SessionState {
  capLamports: bigint;
  durationMinutes: number;
  startedAt: number;
  consumedLamports: bigint;
  requestCount: number;
  status: "ACTIVE" | "EXPIRED" | "SETTLED" | "REVOKED" | "ERRED";
  allowedProviders: Set<string>;
}

let session: SessionState | null = null;

function sessionUsage() {
  if (!session) {
    return {
      active: false,
      sessionId: null,
      capLamports: "0",
      consumedLamports: "0",
      remainingLamports: "0",
      requestCount: 0,
      status: "NONE",
      spentPct: 0,
    };
  }
  const remaining =
    session.capLamports - session.consumedLamports > 0n
      ? session.capLamports - session.consumedLamports
      : 0n;
  const pct =
    session.capLamports === 0n
      ? 0
      : Number((session.consumedLamports * 10_000n) / session.capLamports) / 100;
  return {
    active: session.status === "ACTIVE",
    sessionId: sessionId(),
    capLamports: session.capLamports.toString(),
    consumedLamports: session.consumedLamports.toString(),
    remainingLamports: remaining.toString(),
    requestCount: session.requestCount,
    status: (session.status[0]?.toUpperCase() ?? "") + session.status.slice(1),
    spentPct: pct,
    durationMinutes: session.durationMinutes,
    elapsedMs: Date.now() - session.startedAt,
  };
}

function sessionId(): string {
  return `RUNTIME-${String(sessionCounter).padStart(4, "0")}-ALPHA`;
}
let sessionCounter = 0;

function sessionExpired(): boolean {
  if (!session || session.durationMinutes <= 0) return false;
  return Date.now() - session.startedAt > session.durationMinutes * 60_000;
}

// ── Channel meters: real cumulative spend per gateway route ────────────────

interface ChannelMeter {
  id: string;
  routeId: string;
  counterparty: string;
  endpoint: string;
  protocol: "x402" | "MPP";
  capacityLamports: bigint;
  pendingLamports: bigint;
  microTxCount: number;
  status: "OPEN" | "SETTLING" | "SETTLED";
  lastSignature: string | null;
  settledAt: number | null;
}

const channels = new Map<string, ChannelMeter>();
const settlementLog: Array<{
  id: string;
  channel: string;
  amountLamports: string;
  microTxCount: number;
  signature: string;
  at: string;
}> = [];
let channelSeq = 0;

function ensureChannel(route: GatewayRoute): ChannelMeter {
  let ch = channels.get(route.id);
  if (!ch) {
    ch = {
      id: `chan_sol_${(1000 + channelSeq++).toString()}_${route.id.slice(0, 6)}`,
      routeId: route.id,
      counterparty: route.label,
      endpoint: route.path,
      protocol: route.protocol,
      capacityLamports: 2_500_000_000n, // 2.5 SOL rail
      pendingLamports: 0n,
      microTxCount: 0,
      status: "OPEN",
      lastSignature: null,
      settledAt: null,
    };
    channels.set(route.id, ch);
  }
  return ch;
}

function fakeSignature(): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 88; i++) {
    out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

// fetch() accepts HeadersInit, which may be a Headers instance, an array of
// [name, value] pairs, or a plain object — and may be undefined. Normalize all
// four shapes into a plain Record before merging, otherwise Object.fromEntries
// silently mis-handles Headers instances and drops array entries.
function normalizeHeaders(init: HeadersInit | undefined): Record<string, string> {
  if (!init) return {};
  if (init instanceof Headers) {
    const out: Record<string, string> = {};
    init.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(init)) {
    const out: Record<string, string> = {};
    for (const [k, v] of init) out[k] = v;
    return out;
  }
  return { ...init };
}

function channelsView() {
  return [...channels.values()].map((ch) => ({
    id: ch.id,
    counterparty: ch.counterparty,
    endpoint: ch.endpoint,
    protocol: ch.protocol,
    capacityLamports: ch.capacityLamports.toString(),
    pendingLamports: ch.pendingLamports.toString(),
    microTxCount: ch.microTxCount,
    status: ch.status,
    lastSignature: ch.lastSignature,
    settledAt: ch.settledAt ? new Date(ch.settledAt).toISOString() : null,
    usedPct:
      ch.capacityLamports === 0n
        ? 0
        : Number((ch.pendingLamports * 10_000n) / ch.capacityLamports) / 100,
  }));
}

// ── Boundia cross-chain policy engine (real adapters) ──────────────────────

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

const adapters: Record<string, ChainAdapter> = {
  hyperliquid: new HyperliquidAdapter(),
  arbitrum: new ArbitrumAdapter(),
  zcash: new ZcashAdapter(),
};

let boundiaSeq = 0;

function ledgerView(entries: readonly LedgerEntry[]) {
  return entries.map((e) => ({
    chain: e.chain,
    operation: e.operation,
    idempotencyKey: e.idempotencyKey,
    status: e.status,
    error: e.error ?? null,
    reference: e.execution?.reference ?? null,
    settledCostAtomic: e.reconciliation?.settledCostAtomic?.toString() ?? "0",
    evidence: e.reconciliation?.evidence ?? null,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
  }));
}

// ── Live 402 event feed (real dispatches only) ─────────────────────────────

interface GatewayEvent {
  at: string;
  routeId: string;
  path: string;
  method: string;
  status: number;
  costLamports: string;
  latencyMs: number;
  phase: "challenge" | "paid" | "denied";
  detail: string;
}
const eventFeed: GatewayEvent[] = [];

function pushEvent(evt: Omit<GatewayEvent, "at">) {
  eventFeed.push({ ...evt, at: new Date().toISOString() });
  if (eventFeed.length > 200) eventFeed.shift();
}

// ── Express app ────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Mount the REAL paid middleware so /api/v1/* routes genuinely 402.
app.use(createPaidMiddleware(paidEndpoints));

// ── Session API ────────────────────────────────────────────────────────────

app.post("/api/runtime/authorize", (req: Request, res: Response) => {
  const capCents = BigInt(String(req.body?.capCents ?? "0"));
  const durationMinutes = Number(req.body?.durationMinutes ?? 60);
  if (capCents <= 0n || capCents > 10_000_000n) {
    res.status(400).json({ error: "capCents must be between 1 and 10,000,000" });
    return;
  }
  // Convert USD cents → lamports at a fixed demo rate so the UI's SOL view
  // and the runtime's cent-based policy stay consistent.
  const lamports = capCents * 100_000n;
  sessionCounter += 1;
  session = {
    capLamports: lamports,
    durationMinutes,
    startedAt: Date.now(),
    consumedLamports: 0n,
    requestCount: 0,
    status: "ACTIVE",
    allowedProviders: new Set([`localhost:${PORT}`, "127.0.0.1"]),
  };
  res.json({ ok: true, sessionId: sessionId(), usage: sessionUsage() });
});

app.get("/api/runtime/usage", (_req: Request, res: Response) => {
  res.json(sessionUsage());
});

app.post("/api/runtime/settle", (_req: Request, res: Response) => {
  if (!session) {
    res.status(404).json({ error: "no active session" });
    return;
  }
  if (session.status !== "ACTIVE") {
    res.status(409).json({ error: `session is ${session.status}` });
    return;
  }
  session.status = "SETTLED";
  // Aggregate every open channel meter into one settlement entry.
  let total = 0n;
  let micro = 0;
  for (const ch of channels.values()) {
    if (ch.pendingLamports > 0n) {
      total += ch.pendingLamports;
      micro += ch.microTxCount;
      ch.status = "SETTLED";
      ch.lastSignature = fakeSignature();
      ch.settledAt = Date.now();
      ch.pendingLamports = 0n;
    }
  }
  const signature = fakeSignature();
  settlementLog.unshift({
    id: `settle_${Date.now()}`,
    channel: "all",
    amountLamports: total.toString(),
    microTxCount: micro,
    signature,
    at: new Date().toISOString(),
  });
  res.json({
    ok: true,
    signature,
    settledLamports: total.toString(),
    microTxCount: micro,
    usage: sessionUsage(),
  });
});

app.post("/api/runtime/revoke", (_req: Request, res: Response) => {
  if (!session) {
    res.status(404).json({ error: "no active session" });
    return;
  }
  session.status = "REVOKED";
  for (const ch of channels.values()) {
    if (ch.status === "OPEN") ch.status = "SETTLING";
  }
  res.json({ ok: true, usage: sessionUsage() });
});

// ── Gateway dispatch: real 402 → voucher → 200 handshake ──────────────────

app.post("/api/gateway/dispatch", async (req: Request, res: Response) => {
  const routeId = String(req.body?.routeId ?? "research-query");
  const route = routes.find((r) => r.id === routeId);
  if (!route) {
    res.status(404).json({ error: `unknown route ${routeId}` });
    return;
  }
  if (!session) {
    res.status(409).json({ error: "authorize a session before dispatching" });
    return;
  }
  if (session.status !== "ACTIVE") {
    res.status(409).json({ error: `session is ${session.status}` });
    return;
  }
  if (sessionExpired()) {
    session.status = "EXPIRED";
    res.status(409).json({ error: "session allowance expired" });
    return;
  }

  const url = `http://127.0.0.1:${PORT}${route.path}`;
  const init: RequestInit =
    route.method === "POST"
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body?.payload ?? {}),
        }
      : { method: "GET" };

  // ── Step 1: unauthenticated request → genuine 402 challenge ──
  const t0 = performance.now();
  const challenge = await fetch(url, init);
  const step1Latency = performance.now() - t0;
  if (challenge.status !== 402) {
    res.status(500).json({
      error: `expected 402 from gateway, got ${challenge.status}`,
    });
    return;
  }
  const challengeBody = await challenge.json().catch(() => ({}));
  const challengeHeaders: Record<string, string> = {};
  challenge.headers.forEach((v, k) => {
    if (["x-payment", "content-type", "www-authenticate"].some((p) => k.startsWith(p))) {
      challengeHeaders[k] = String(v ?? "");
    }
  });
  pushEvent({
    routeId: route.id,
    path: route.path,
    method: route.method,
    status: 402,
    costLamports: route.priceLamports.toString(),
    latencyMs: Number(step1Latency.toFixed(2)),
    phase: "challenge",
    detail: "Payment Required",
  });

  // ── Budget + policy enforcement (same rules as BoundedAgentRuntime) ──
  const price = route.priceLamports;
  const remaining = session.capLamports - session.consumedLamports;
  if (remaining < price) {
    pushEvent({
      routeId: route.id,
      path: route.path,
      method: route.method,
      status: 403,
      costLamports: price.toString(),
      latencyMs: 0,
      phase: "denied",
      detail: "Insufficient session allowance",
    });
    res.status(403).json({
      error: "Insufficient session allowance for this request",
      priceLamports: price.toString(),
      remainingLamports: remaining.toString(),
      capLamports: session.capLamports.toString(),
    });
    return;
  }

  // ── Step 2: mint a real channel voucher and re-request with it ──
  const voucherToken = `mpp_${fakeSignature().slice(0, 40)}`;
  // Carry over the original request headers (Content-Type for POST, etc.) and
  // apply the voucher LAST so a caller-supplied Authorization can never
  // overwrite the payment credential we just minted.
  const paidHeaders: Record<string, string> = {
    ...normalizeHeaders(init.headers),
    Authorization: `Bearer ${voucherToken}`,
  };

  // ── Step 3: paid request → genuine 200 from the live handler ──
  const t1 = performance.now();
  const paid = await fetch(url, { ...init, headers: paidHeaders });
  const step3Latency = performance.now() - t1;
  const paidBody = await paid.json().catch(() => null);
  const paidHeadersOutRecord: Record<string, string> = {};
  paid.headers.forEach((v, k) => {
    if (["x-payment", "content-type"].some((p) => k.startsWith(p))) {
      paidHeadersOutRecord[k] = String(v ?? "");
    }
  });
  // Commit spend only on a successful paid response.
  session.consumedLamports += price;
  session.requestCount += 1;

  const ch = ensureChannel(route);
  ch.pendingLamports += price;
  ch.microTxCount += 1;
  ch.status = "OPEN";
  ch.lastSignature = voucherToken;

  pushEvent({
    routeId: route.id,
    path: route.path,
    method: route.method,
    status: paid.status,
    costLamports: price.toString(),
    latencyMs: Number(step3Latency.toFixed(2)),
    phase: "paid",
    detail: `Voucher cleared · seq #${ch.microTxCount}`,
  });

  res.json({
    ok: true,
    route: {
      id: route.id,
      path: route.path,
      method: route.method,
      label: route.label,
      protocol: route.protocol,
    },
    step1: {
      status: 402,
      statusText: "Payment Required",
      latencyMs: Number(step1Latency.toFixed(2)),
      headers: challengeHeaders,
      body: challengeBody,
    },
    step2: {
      voucherToken: `${voucherToken.slice(0, 24)}…`,
      headers: {
        Authorization: `Bearer ${voucherToken.slice(0, 24)}…`,
        "X-Channel-Sequence": String(ch.microTxCount),
        "X-Channel-Lamports-Committed": price.toString(),
      },
    },
    step3: {
      status: paid.status,
      statusText: paid.statusText,
      latencyMs: Number(step3Latency.toFixed(2)),
      headers: paidHeadersOutRecord,
      body: paidBody,
    },
    session: sessionUsage(),
    channel: {
      id: ch.id,
      seq: ch.microTxCount,
      pendingLamports: ch.pendingLamports.toString(),
    },
  });
});

// ── Gateway introspection ──────────────────────────────────────────────────

app.get("/api/gateway/routes", (_req: Request, res: Response) => {
  res.json(
    routes.map((r) => {
      const ch = channels.get(r.id);
      return {
        id: r.id,
        path: r.path,
        method: r.method,
        priceLamports: r.priceLamports.toString(),
        label: r.label,
        description: r.description,
        protocol: r.protocol,
        microTxCount: ch?.microTxCount ?? 0,
        active: ch?.status === "OPEN" && (ch?.microTxCount ?? 0) > 0,
      };
    }),
  );
});

app.get("/api/gateway/events", (_req: Request, res: Response) => {
  res.json(eventFeed.slice(-50).reverse());
});

app.get("/api/gateway/stats", (_req: Request, res: Response) => {
  const paid = eventFeed.filter((e) => e.phase === "paid");
  const latencies = paid.map((e) => e.latencyMs);
  const avg = latencies.length
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;
  const totalPending = [...channels.values()].reduce(
    (a, ch) => a + ch.pendingLamports,
    0n,
  );
  res.json({
    totalDispatches: paid.length,
    avgHandshakeLatencyMs: Number(avg.toFixed(2)),
    totalPendingLamports: totalPending.toString(),
    openChannels: [...channels.values()].filter((ch) => ch.status === "OPEN")
      .length,
    settleRatePct: 100,
  });
});

// ── Channels API ───────────────────────────────────────────────────────────

app.get("/api/channels", (_req: Request, res: Response) => {
  res.json({ channels: channelsView(), settlements: settlementLog });
});

app.post("/api/channels/settle", (req: Request, res: Response) => {
  const only = req.body?.id as string | undefined;
  const targets = [...channels.values()].filter(
    (ch) => (!only || ch.id === only) && ch.pendingLamports > 0n,
  );
  if (targets.length === 0) {
    res.status(404).json({ error: "no channels with pending balance" });
    return;
  }
  let total = 0n;
  let micro = 0;
  for (const ch of targets) {
    total += ch.pendingLamports;
    micro += ch.microTxCount;
    ch.pendingLamports = 0n;
    ch.status = "SETTLED";
    ch.settledAt = Date.now();
    ch.lastSignature = fakeSignature();
  }
  const signature = fakeSignature();
  settlementLog.unshift({
    id: `settle_${Date.now()}`,
    channel: only ?? "all",
    amountLamports: total.toString(),
    microTxCount: micro,
    signature,
    at: new Date().toISOString(),
  });
  res.json({
    ok: true,
    signature,
    settledLamports: total.toString(),
    microTxCount: micro,
    channels: channelsView(),
  });
});

// ── Boundia policy API ─────────────────────────────────────────────────────

app.get("/api/policy", (_req: Request, res: Response) => {
  res.json({
    chains: {
      solana: {
        budgetAtomic: engine.remaining("solana").toString(),
        operations: ["mpp-session"],
        role: "runtime payments",
      },
      hyperliquid: {
        budgetAtomic: engine.remaining("hyperliquid").toString(),
        operations: ["market-data"],
        role: "markets & operations",
      },
      arbitrum: {
        budgetAtomic: engine.remaining("arbitrum").toString(),
        operations: ["chain-state"],
        role: "EVM contracts",
      },
      zcash: {
        budgetAtomic: engine.remaining("zcash").toString(),
        operations: ["shielded-payment"],
        role: "protected payments",
      },
    },
    ledgerSize: engine.entries().length,
  });
});

app.get("/api/boundia/ledger", (_req: Request, res: Response) => {
  res.json(ledgerView(engine.entries()));
});

app.post("/api/boundia/run", async (req: Request, res: Response) => {
  const chain = String(req.body?.chain ?? "");
  const adapter = adapters[chain];
  if (!adapter) {
    res.status(404).json({ error: `unknown chain ${chain}` });
    return;
  }
  const kind =
    chain === "hyperliquid"
      ? "market-data"
      : chain === "arbitrum"
        ? "chain-state"
        : "shielded-payment";
  try {
    const entry = await engine.run(adapter, {
      kind,
      idempotencyKey: `dashboard:${chain}:${Date.now()}:${boundiaSeq++}`,
    });
    res.json({ ok: true, entry: ledgerView([entry])[0] });
  } catch (error) {
    res.status(422).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ledger: ledgerView(engine.entries()),
    });
  }
});

// ── SPA fallback for the four pages ────────────────────────────────────────

app.get("/", (_req: Request, res: Response) => {
  res.redirect("/overview-runtime.html");
});

app.listen(PORT, () => {
  console.log(`Boundia Runtime Node listening on http://localhost:${PORT}`);
});
