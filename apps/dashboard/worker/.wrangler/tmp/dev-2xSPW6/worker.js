var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// dist/worker.js
var ROUTES = [
  {
    id: "research-query",
    path: "/api/v1/research-query",
    method: "POST",
    priceLamports: 1000000n,
    label: "Deep Research Query",
    description: "Solana liquidity-depth audit across sampled pools.",
    protocol: "x402",
    handler: /* @__PURE__ */ __name(async (req) => {
      const body = await safeJson(req);
      return {
        status: "success",
        result: {
          query: body?.task ?? "solana-liquidity-depth-audit",
          agent: body?.agent_id ?? "unbound-agent",
          sampled_pools: 42,
          total_liquidity_usd: 1845e5,
          slippage_index: 41e-5,
          timestamp: Math.floor(Date.now() / 1e3)
        }
      };
    }, "handler")
  },
  {
    id: "orderbook-l2-snapshot",
    path: "/api/v1/orderbook-l2-snapshot",
    method: "GET",
    priceLamports: 200000n,
    label: "Orderbook L2 Snapshot",
    description: "Aggregated L2 depth for a major Solana market.",
    protocol: "x402",
    handler: /* @__PURE__ */ __name(async (req) => {
      const symbol = new URL(req.url).searchParams.get("symbol") ?? "SOL/USDC";
      return { symbol, bids: 128, asks: 128, mid: 178.42 };
    }, "handler")
  },
  {
    id: "sentiment-x-stream",
    path: "/api/v1/sentiment/x-stream",
    method: "POST",
    priceLamports: 5000000n,
    label: "Sentiment X-Stream",
    description: "Real-time social sentiment scoring for an asset.",
    protocol: "MPP",
    handler: /* @__PURE__ */ __name(async () => ({
      scored: 1284,
      bullish: 0.61,
      bearish: 0.19,
      neutral: 0.2
    }), "handler")
  },
  {
    id: "helius-zk-proof-verify",
    path: "/api/v1/helius-zk-proof-verify",
    method: "POST",
    priceLamports: 2500000n,
    label: "ZK Proof Verify",
    description: "Verify a shielded-state commitment proof.",
    protocol: "MPP",
    handler: /* @__PURE__ */ __name(async () => ({
      verified: true,
      scheme: "groth16",
      tree: "poseidon"
    }), "handler")
  }
];
async function ensureSchema(db) {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS state_kv (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS channels (
         route_id TEXT PRIMARY KEY,
         id TEXT NOT NULL,
         counterparty TEXT NOT NULL,
         endpoint TEXT NOT NULL,
         protocol TEXT NOT NULL,
         capacity_lamports TEXT NOT NULL,
         pending_lamports TEXT NOT NULL,
         micro_tx_count INTEGER NOT NULL,
         status TEXT NOT NULL,
         last_signature TEXT,
         settled_at INTEGER
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS settlements (
         id TEXT PRIMARY KEY,
         channel TEXT NOT NULL,
         amount_lamports TEXT NOT NULL,
         micro_tx_count INTEGER NOT NULL,
         signature TEXT NOT NULL,
         at TEXT NOT NULL
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS events (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         at TEXT NOT NULL,
         route_id TEXT NOT NULL,
         path TEXT NOT NULL,
         method TEXT NOT NULL,
         status INTEGER NOT NULL,
         cost_lamports TEXT NOT NULL,
         latency_ms REAL NOT NULL,
         phase TEXT NOT NULL,
         detail TEXT NOT NULL
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ledger (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         chain TEXT NOT NULL,
         operation TEXT NOT NULL,
         idempotency_key TEXT NOT NULL,
         status TEXT NOT NULL,
         error TEXT,
         reference TEXT,
         settled_cost_atomic TEXT NOT NULL,
         evidence TEXT,
         started_at TEXT NOT NULL,
         finished_at TEXT NOT NULL
       )`
    )
  ]);
}
__name(ensureSchema, "ensureSchema");
function bigIntReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
__name(bigIntReplacer, "bigIntReplacer");
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, bigIntReplacer), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}
__name(json, "json");
async function safeJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
__name(safeJson, "safeJson");
function fakeSignature() {
  const hex = "0123456789abcdef";
  let out = "";
  const bytes = new Uint8Array(88);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += hex[b % 16];
  return out;
}
__name(fakeSignature, "fakeSignature");
var worker_default = {
  async fetch(request, env) {
    await ensureSchema(env.DB);
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/api/policy" && request.method === "GET") {
      return json({
        chains: {
          solana: {
            budgetAtomic: "1000000",
            operations: ["mpp-session"],
            role: "runtime payments"
          },
          hyperliquid: {
            budgetAtomic: "0",
            operations: ["market-data"],
            role: "markets & operations"
          },
          arbitrum: {
            budgetAtomic: "0",
            operations: ["chain-state"],
            role: "EVM contracts"
          },
          zcash: {
            budgetAtomic: "0",
            operations: ["shielded-payment"],
            role: "protected payments"
          }
        },
        ledgerSize: null
      });
    }
    if (path === "/api/boundia/run" && request.method === "POST") {
      const body = await safeJson(request);
      const chain = String(body?.chain ?? "");
      return runBoundiaOp(env.DB, chain, request);
    }
    if (path === "/api/boundia/ledger" && request.method === "GET") {
      const entries = await env.DB.prepare(
        `SELECT chain, operation, idempotency_key, status, error, reference,
                  settled_cost_atomic, evidence, started_at, finished_at
             FROM ledger ORDER BY id DESC LIMIT 200`
      ).all();
      return json(
        (entries.results ?? []).map((r) => ({
          chain: r.chain,
          operation: r.operation,
          idempotencyKey: r.idempotency_key,
          status: r.status,
          error: r.error,
          reference: r.reference,
          settledCostAtomic: r.settled_cost_atomic,
          evidence: r.evidence ? JSON.parse(r.evidence) : null,
          startedAt: r.started_at,
          finishedAt: r.finished_at
        }))
      );
    }
    if (path === "/api/runtime/authorize" && request.method === "POST") {
      const body = await safeJson(request);
      let capCents;
      try {
        capCents = BigInt(String(body?.capCents ?? "0"));
      } catch {
        return json({ error: "capCents must be an integer string" }, 400);
      }
      const durationMinutes = Number(body?.durationMinutes ?? 60);
      if (capCents <= 0n || capCents > 10000000n) {
        return json({ error: "capCents must be between 1 and 10,000,000" }, 400);
      }
      const counterRow = await env.DB.prepare(`SELECT value FROM state_kv WHERE key = 'sessionCounter'`).first();
      const counter = Number(counterRow?.value ?? "0") + 1;
      await env.DB.prepare(
        `INSERT INTO state_kv (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).bind("sessionCounter", String(counter)).run();
      const session = {
        capLamports: capCents * 100000n,
        // USD cents → lamports demo rate
        durationMinutes,
        startedAt: Date.now(),
        consumedLamports: 0n,
        requestCount: 0,
        status: "ACTIVE",
        counter
      };
      await saveSession(env.DB, session);
      return json({ ok: true, sessionId: `RUNTIME-${String(counter).padStart(4, "0")}-ALPHA`, usage: await usageView(env.DB) });
    }
    if (path === "/api/runtime/usage" && request.method === "GET") {
      return json(await usageView(env.DB));
    }
    if (path === "/api/runtime/settle" && request.method === "POST") {
      const session = await loadSession(env.DB);
      if (!session) return json({ error: "no active session" }, 404);
      if (session.status !== "ACTIVE") return json({ error: `session is ${session.status}` }, 409);
      session.status = "SETTLED";
      let total = 0n;
      let micro = 0;
      const chans = await env.DB.prepare(`SELECT * FROM channels WHERE pending_lamports > '0'`).all();
      for (const ch of chans.results ?? []) {
        total += BigInt(ch.pending_lamports);
        micro += ch.micro_tx_count;
      }
      await env.DB.batch([
        env.DB.prepare(`UPDATE channels SET pending_lamports = '0', status = 'SETTLED', settled_at = ?, last_signature = ? WHERE pending_lamports > '0'`).bind(Date.now(), fakeSignature()),
        ...total > 0n ? [
          env.DB.prepare(
            `INSERT INTO settlements (id, channel, amount_lamports, micro_tx_count, signature, at)
                 VALUES (?, 'all', ?, ?, ?, ?)`
          ).bind(`settle_${Date.now()}`, total.toString(), micro, fakeSignature(), (/* @__PURE__ */ new Date()).toISOString())
        ] : []
      ]);
      await saveSession(env.DB, session);
      return json({
        ok: true,
        signature: (chans.results ?? []).length ? fakeSignature() : fakeSignature(),
        settledLamports: total.toString(),
        microTxCount: micro,
        usage: await usageView(env.DB)
      });
    }
    if (path === "/api/runtime/revoke" && request.method === "POST") {
      const session = await loadSession(env.DB);
      if (!session) return json({ error: "no active session" }, 404);
      session.status = "REVOKED";
      await env.DB.batch([
        env.DB.prepare(`UPDATE channels SET status = 'SETTLING' WHERE status = 'OPEN'`)
      ]);
      await saveSession(env.DB, session);
      return json({ ok: true, usage: await usageView(env.DB) });
    }
    if (path === "/api/gateway/dispatch" && request.method === "POST") {
      return dispatchPaid(env.DB, request);
    }
    if (path === "/api/gateway/routes" && request.method === "GET") {
      const chans = await allChannels(env.DB);
      return json(
        ROUTES.map((r) => {
          const ch = chans.find((c) => c.route_id === r.id);
          return {
            id: r.id,
            path: r.path,
            method: r.method,
            priceLamports: r.priceLamports.toString(),
            label: r.label,
            description: r.description,
            protocol: r.protocol,
            microTxCount: ch?.micro_tx_count ?? 0,
            active: ch?.status === "OPEN" && (ch?.micro_tx_count ?? 0) > 0
          };
        })
      );
    }
    if (path === "/api/gateway/events" && request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT at, route_id, path, method, status, cost_lamports, latency_ms, phase, detail
             FROM events ORDER BY seq DESC LIMIT 50`
      ).all();
      return json(
        (rows.results ?? []).map((r) => ({
          at: r.at,
          routeId: r.route_id,
          path: r.path,
          method: r.method,
          status: r.status,
          costLamports: r.cost_lamports,
          latencyMs: r.latency_ms,
          phase: r.phase,
          detail: r.detail
        }))
      );
    }
    if (path === "/api/gateway/stats" && request.method === "GET") {
      const paid = await env.DB.prepare(`SELECT latency_ms FROM events WHERE phase = 'paid' ORDER BY seq DESC LIMIT 200`).all();
      const latencies = (paid.results ?? []).map((r) => r.latency_ms);
      const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
      const chans = await allChannels(env.DB);
      const totalPending = chans.reduce((a, ch) => a + BigInt(ch.pending_lamports), 0n);
      return json({
        totalDispatches: latencies.length,
        avgHandshakeLatencyMs: Number(avg.toFixed(2)),
        totalPendingLamports: totalPending.toString(),
        openChannels: chans.filter((ch) => ch.status === "OPEN").length,
        settleRatePct: 100
      });
    }
    if (path === "/api/channels" && request.method === "GET") {
      const chans = await allChannels(env.DB);
      const settlements = await env.DB.prepare(`SELECT id, channel, amount_lamports, micro_tx_count, signature, at FROM settlements ORDER BY rowid DESC LIMIT 100`).all();
      return json({
        channels: chans.map((ch) => ({
          id: ch.id,
          counterparty: ch.counterparty,
          endpoint: ch.endpoint,
          protocol: ch.protocol,
          capacityLamports: ch.capacity_lamports,
          pendingLamports: ch.pending_lamports,
          microTxCount: ch.micro_tx_count,
          status: ch.status,
          lastSignature: ch.last_signature,
          settledAt: ch.settled_at ? new Date(ch.settled_at).toISOString() : null,
          usedPct: BigInt(ch.capacity_lamports) === 0n ? 0 : Number(BigInt(ch.pending_lamports) * 10000n / BigInt(ch.capacity_lamports)) / 100
        })),
        settlements: (settlements.results ?? []).map((s) => ({
          id: s.id,
          channel: s.channel,
          amountLamports: s.amount_lamports,
          microTxCount: s.micro_tx_count,
          signature: s.signature,
          at: s.at
        }))
      });
    }
    if (path === "/api/channels/settle" && request.method === "POST") {
      return settleChannels(env.DB, request);
    }
    const paidRoute = ROUTES.find(
      (r) => r.path === path && r.method === request.method
    );
    if (paidRoute) {
      return paidEndpointHandler(env.DB, request, paidRoute);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Not Found" }, 404);
    }
    const tried = [
      path === "/" ? "/overview-runtime.html" : path,
      path.endsWith(".html") ? path : `${path}.html`
    ];
    for (const candidate of tried) {
      const asset = await env.ASSETS.fetch(new URL(candidate, request.url));
      if (asset.status === 200) return asset;
    }
    return json({ error: "Not Found" }, 404);
  }
};
async function paidEndpointHandler(db, request, route) {
  const auth = request.headers.get("authorization") ?? "";
  const credential = auth.startsWith("Bearer ") ? auth.slice(7) : void 0;
  if (!credential) {
    return json(
      {
        error: "Payment Required",
        price: route.priceLamports.toString(),
        asset: "SOL",
        payable: true
      },
      402,
      {
        "X-Payment-Amount": route.priceLamports.toString(),
        "X-Payment-Asset": "SOL",
        "X-Payment-Required": "Bearer <x402 voucher>"
      }
    );
  }
  const result = await route.handler(request);
  return json(result, 200, {
    "X-Payment-Amount": route.priceLamports.toString(),
    "X-Payment-Receipt": `receipt-${route.path}-${Date.now()}`
  });
}
__name(paidEndpointHandler, "paidEndpointHandler");
async function dispatchPaid(db, request) {
  const body = await safeJson(request);
  const routeId = String(body?.routeId ?? "research-query");
  const route = ROUTES.find((r) => r.id === routeId);
  if (!route) return json({ error: `unknown route ${routeId}` }, 404);
  const session = await loadSession(db);
  if (!session) return json({ error: "authorize a session before dispatching" }, 409);
  if (session.status !== "ACTIVE") return json({ error: `session is ${session.status}` }, 409);
  if (session.durationMinutes > 0 && Date.now() - session.startedAt > session.durationMinutes * 6e4) {
    session.status = "EXPIRED";
    await saveSession(db, session);
    return json({ error: "session allowance expired" }, 409);
  }
  const origin = new URL(request.url).origin;
  const init = route.method === "POST" ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body?.payload ?? { agent_id: "boundia-researcher-node-04", task: "solana-liquidity-depth-audit" })
  } : { method: "GET" };
  const t0 = Date.now();
  const challenge = await fetch(`${origin}${route.path}`, init);
  const step1Latency = Date.now() - t0;
  if (challenge.status !== 402) {
    return json({ error: `expected 402 from gateway, got ${challenge.status}` }, 500);
  }
  const challengeBody = await challenge.json().catch(() => ({}));
  const challengeHeaders = {};
  challenge.headers.forEach((v, k) => {
    if (["x-payment", "content-type", "www-authenticate"].some((p) => k.startsWith(p))) {
      challengeHeaders[k] = String(v ?? "");
    }
  });
  await pushEvent(db, {
    routeId: route.id,
    path: route.path,
    method: route.method,
    status: 402,
    costLamports: route.priceLamports.toString(),
    latencyMs: step1Latency,
    phase: "challenge",
    detail: "Payment Required"
  });
  const price = route.priceLamports;
  const remaining = session.capLamports - session.consumedLamports;
  if (remaining < price) {
    await pushEvent(db, {
      routeId: route.id,
      path: route.path,
      method: route.method,
      status: 403,
      costLamports: price.toString(),
      latencyMs: 0,
      phase: "denied",
      detail: "Insufficient session allowance"
    });
    return json(
      {
        error: "Insufficient session allowance for this request",
        priceLamports: price.toString(),
        remainingLamports: remaining.toString(),
        capLamports: session.capLamports.toString()
      },
      403
    );
  }
  const voucherToken = `mpp_${fakeSignature().slice(0, 40)}`;
  const ch = await ensureChannel(db, route);
  const channelSeq = ch.micro_tx_count + 1;
  const targetUrl = `${origin}${route.path}`;
  const targetInit = route.method === "POST" ? {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${voucherToken}`
    },
    body: JSON.stringify(body?.payload ?? {})
  } : { method: "GET", headers: { Authorization: `Bearer ${voucherToken}` } };
  const t1 = Date.now();
  const paid = await fetch(targetUrl, targetInit);
  const step3Latency = Date.now() - t1;
  const paidBody = await paid.json().catch(() => null);
  const paidHeadersOut = {};
  paid.headers.forEach((v, k) => {
    if (["x-payment", "content-type"].some((p) => k.startsWith(p))) {
      paidHeadersOut[k] = String(v ?? "");
    }
  });
  session.consumedLamports += price;
  session.requestCount += 1;
  await saveSession(db, session);
  await db.prepare(
    `UPDATE channels
          SET pending_lamports = CAST(CAST(pending_lamports AS INTEGER) + ? AS TEXT),
              micro_tx_count = ?,
              status = 'OPEN',
              last_signature = ?
        WHERE route_id = ?`
  ).bind(price.toString(), channelSeq, voucherToken, route.id).run();
  await pushEvent(db, {
    routeId: route.id,
    path: route.path,
    method: route.method,
    status: paid.status,
    costLamports: price.toString(),
    latencyMs: step3Latency,
    phase: "paid",
    detail: `Voucher cleared \xB7 seq #${channelSeq}`
  });
  const chAfter = await db.prepare(`SELECT id, micro_tx_count, pending_lamports FROM channels WHERE route_id = ?`).bind(route.id).first();
  return json({
    ok: true,
    route: {
      id: route.id,
      path: route.path,
      method: route.method,
      label: route.label,
      protocol: route.protocol
    },
    step1: {
      status: 402,
      statusText: "Payment Required",
      latencyMs: step1Latency,
      headers: challengeHeaders,
      body: challengeBody
    },
    step2: {
      voucherToken: `${voucherToken.slice(0, 24)}\u2026`,
      headers: {
        Authorization: `Bearer ${voucherToken.slice(0, 24)}\u2026`,
        "X-Channel-Sequence": String(channelSeq),
        "X-Channel-Lamports-Committed": price.toString()
      }
    },
    step3: {
      status: paid.status,
      statusText: paid.statusText,
      latencyMs: step3Latency,
      headers: paidHeadersOut,
      body: paidBody
    },
    session: await usageView(db),
    channel: {
      id: chAfter?.id ?? ch.id,
      seq: chAfter?.micro_tx_count ?? channelSeq,
      pendingLamports: chAfter?.pending_lamports ?? price.toString()
    }
  });
}
__name(dispatchPaid, "dispatchPaid");
async function allChannels(db) {
  const rows = await db.prepare(`SELECT * FROM channels`).all();
  return rows.results ?? [];
}
__name(allChannels, "allChannels");
async function ensureChannel(db, route) {
  const existing = await db.prepare(`SELECT * FROM channels WHERE route_id = ?`).bind(route.id).first();
  if (existing) return existing;
  const countRow = await db.prepare(`SELECT COUNT(*) as n FROM channels`).first();
  const seq = (countRow?.n ?? 0) + 1e3;
  const ch = {
    route_id: route.id,
    id: `chan_sol_${seq}_${route.id.slice(0, 6)}`,
    counterparty: route.label,
    endpoint: route.path,
    protocol: route.protocol,
    capacity_lamports: "2500000000",
    // 2.5 SOL rail
    pending_lamports: "0",
    micro_tx_count: 0,
    status: "OPEN",
    last_signature: null,
    settled_at: null
  };
  await db.prepare(
    `INSERT INTO channels (route_id, id, counterparty, endpoint, protocol,
                             capacity_lamports, pending_lamports, micro_tx_count,
                             status, last_signature, settled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    ch.route_id,
    ch.id,
    ch.counterparty,
    ch.endpoint,
    ch.protocol,
    ch.capacity_lamports,
    ch.pending_lamports,
    ch.micro_tx_count,
    ch.status,
    ch.last_signature,
    ch.settled_at
  ).run();
  return ch;
}
__name(ensureChannel, "ensureChannel");
async function settleChannels(db, request) {
  const body = await safeJson(request);
  const only = body?.id;
  const targets = (await allChannels(db)).filter(
    (ch) => (!only || ch.id === only) && BigInt(ch.pending_lamports) > 0n
  );
  if (targets.length === 0) {
    return json({ error: "no channels with pending balance" }, 404);
  }
  let total = 0n;
  let micro = 0;
  for (const ch of targets) {
    total += BigInt(ch.pending_lamports);
    micro += ch.micro_tx_count;
  }
  const signature = fakeSignature();
  await db.batch([
    db.prepare(
      `UPDATE channels SET pending_lamports = '0', status = 'SETTLED', settled_at = ?, last_signature = ?
        WHERE pending_lamports > '0' ${only ? `AND id = ?` : ""}`
    ).bind(Date.now(), signature, ...only ? [only] : []),
    db.prepare(
      `INSERT INTO settlements (id, channel, amount_lamports, micro_tx_count, signature, at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(`settle_${Date.now()}`, only ?? "all", total.toString(), micro, signature, (/* @__PURE__ */ new Date()).toISOString())
  ]);
  return json({
    ok: true,
    signature,
    settledLamports: total.toString(),
    microTxCount: micro
  });
}
__name(settleChannels, "settleChannels");
async function loadSession(db) {
  const row = await db.prepare(`SELECT value FROM state_kv WHERE key = 'session'`).first();
  if (!row) return null;
  const raw = JSON.parse(row.value);
  return {
    ...raw,
    capLamports: BigInt(raw.capLamports),
    consumedLamports: BigInt(raw.consumedLamports)
  };
}
__name(loadSession, "loadSession");
async function saveSession(db, session) {
  await db.prepare(
    `INSERT INTO state_kv (key, value) VALUES ('session', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(JSON.stringify(session, bigIntReplacer)).run();
}
__name(saveSession, "saveSession");
async function usageView(db) {
  const session = await loadSession(db);
  if (!session) {
    return {
      active: false,
      sessionId: null,
      capLamports: "0",
      consumedLamports: "0",
      remainingLamports: "0",
      requestCount: 0,
      status: "NONE",
      spentPct: 0
    };
  }
  const remaining = session.capLamports - session.consumedLamports > 0n ? session.capLamports - session.consumedLamports : 0n;
  const pct = session.capLamports === 0n ? 0 : Number(session.consumedLamports * 10000n / session.capLamports) / 100;
  return {
    active: session.status === "ACTIVE",
    sessionId: `RUNTIME-${String(session.counter).padStart(4, "0")}-ALPHA`,
    capLamports: session.capLamports.toString(),
    consumedLamports: session.consumedLamports.toString(),
    remainingLamports: remaining.toString(),
    requestCount: session.requestCount,
    status: session.status,
    spentPct: pct,
    durationMinutes: session.durationMinutes,
    elapsedMs: Date.now() - session.startedAt
  };
}
__name(usageView, "usageView");
async function pushEvent(db, evt) {
  await db.prepare(
    `INSERT INTO events (at, route_id, path, method, status, cost_lamports, latency_ms, phase, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    (/* @__PURE__ */ new Date()).toISOString(),
    evt.routeId,
    evt.path,
    evt.method,
    evt.status,
    evt.costLamports,
    evt.latencyMs,
    evt.phase,
    evt.detail
  ).run();
}
__name(pushEvent, "pushEvent");
async function runBoundiaOp(db, chain, _req) {
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const idempotencyKey = `worker:${chain}:${Date.now()}:${Math.floor(Math.random() * 1e6)}`;
  let reference = "";
  let evidence = {};
  let status = "completed";
  let error = null;
  try {
    if (chain === "hyperliquid") {
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
        signal: AbortSignal.timeout(1e4)
      });
      if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`);
      const payload = await res.json();
      const [meta, ctxs] = payload;
      reference = `hyperliquid:metaAndAssetCtxs:${JSON.stringify(payload).length}`;
      evidence = {
        endpoint: "https://api.hyperliquid.xyz/info",
        observedAt: (/* @__PURE__ */ new Date()).toISOString(),
        universeSize: meta.universe?.length ?? 0,
        topAssets: (meta.universe ?? []).slice(0, 5).map((a, i) => ({ symbol: a.name, markPx: String(ctxs[i]?.markPx ?? "unknown") }))
      };
    } else if (chain === "arbitrum") {
      const rpcUrl = "https://arb1.arbitrum.io/rpc";
      const doRpc = /* @__PURE__ */ __name(async (method, params) => {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(1e4)
        });
        const body = await res.json();
        if (body.error) throw new Error(`Arbitrum RPC ${method}: ${body.error.message}`);
        return body.result;
      }, "doRpc");
      const chainId = await doRpc("eth_chainId", []);
      const blockNumber = await doRpc("eth_blockNumber", []);
      reference = `arbitrum:${parseInt(chainId, 16)}:${parseInt(blockNumber, 16)}`;
      evidence = {
        rpcUrl,
        observedAt: (/* @__PURE__ */ new Date()).toISOString(),
        chainIdHex: chainId,
        blockNumberHex: blockNumber,
        confirmedBlock: String(parseInt(blockNumber, 16))
      };
    } else if (chain === "zcash") {
      throw new Error(
        `Policy rejected zcash: adapter does not implement the required phases (requires shielded key management; tracked as P1)`
      );
    } else {
      return json({ error: `unknown chain ${chain}` }, 404);
    }
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
  }
  await db.prepare(
    `INSERT INTO ledger (chain, operation, idempotency_key, status, error, reference,
                           settled_cost_atomic, evidence, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    chain,
    chain === "hyperliquid" ? "market-data" : chain === "arbitrum" ? "chain-state" : "shielded-payment",
    idempotencyKey,
    status,
    error,
    reference,
    "0",
    JSON.stringify(evidence),
    startedAt,
    (/* @__PURE__ */ new Date()).toISOString()
  ).run();
  if (error) {
    return json({ ok: false, error, ledgerSize: await rowCount(db, "ledger") }, 422);
  }
  return json({
    ok: true,
    entry: {
      chain,
      operation: chain === "hyperliquid" ? "market-data" : "chain-state",
      idempotencyKey,
      status,
      error: null,
      reference,
      settledCostAtomic: "0",
      evidence,
      startedAt,
      finishedAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  });
}
__name(runBoundiaOp, "runBoundiaOp");
async function rowCount(db, table) {
  const row = await db.prepare(`SELECT COUNT(*) as n FROM ${table}`).first();
  return row?.n ?? 0;
}
__name(rowCount, "rowCount");

// ../../../node_modules/.pnpm/wrangler@4.149.0_@cloudflare+workers-types@4.20260702.1_bufferutil@4.1.0_utf-8-validate@6.0.6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../node_modules/.pnpm/wrangler@4.149.0_@cloudflare+workers-types@4.20260702.1_bufferutil@4.1.0_utf-8-validate@6.0.6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-n6oI9K/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../node_modules/.pnpm/wrangler@4.149.0_@cloudflare+workers-types@4.20260702.1_bufferutil@4.1.0_utf-8-validate@6.0.6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-n6oI9K/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
