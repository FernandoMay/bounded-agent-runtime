/**
 * Dashboard API integration tests.
 *
 * Boots the compiled server (dist/server.js) on an ephemeral port with an
 * isolated DASH_DATA_DIR, then exercises the real HTTP surface:
 *
 *   - authorize: validation + session creation
 *   - dispatch: genuine 402 challenge → voucher → 200 paid response
 *   - budget enforcement: over-cap refusal
 *   - settle/revoke lifecycle + settlement log
 *   - persistence: state survives a server restart within the same data dir
 *
 * Run: pnpm --filter dashboard test   (requires a prior `pnpm --filter dashboard build`)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.join(__dirname, "..", "dist", "server.js");

/** Ask the OS for a free TCP port, then release it for the server. */
async function freePort() {
  const { createServer } = await import("node:net");
  const probe = createServer().listen(0, "127.0.0.1");
  await new Promise((r) => probe.once("listening", r));
  const port = probe.address().port;
  probe.close();
  return port;
}

test("dashboard API lifecycle", { concurrency: false }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "boundia-test-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [SERVER_JS], {
    env: { ...process.env, PORT: String(port), DASH_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (c) => (out += c.toString()));
  child.stderr.on("data", (c) => (out += c.toString()));

  try {
    // ── readiness ──────────────────────────────────────────────
    await assert.doesNotReject(
      async () => {
        for (let i = 0; i < 100; i++) {
          try {
            const r = await fetch(`${base}/api/gateway/routes`);
            if (r.ok) return;
          } catch {}
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error(`server never became ready:\n${out}`);
      },
      undefined,
      "server failed to start",
    );

    // ── authorize validation ───────────────────────────────────
    {
      const r = await fetch(`${base}/api/runtime/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capCents: "0" }),
      });
      assert.equal(r.status, 400, "cap 0 must be rejected");
    }

    // ── authorize ok ───────────────────────────────────────────
    {
      const r = await fetch(`${base}/api/runtime/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capCents: "1000", durationMinutes: 60 }),
      });
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.equal(b.ok, true);
      assert.match(b.sessionId, /^RUNTIME-\d+-ALPHA$/);
      assert.equal(b.usage.status, "ACTIVE");
    }

    // ── dispatch: genuine 402 → voucher → 200 ─────────────────
    {
      const r = await fetch(`${base}/api/gateway/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId: "research-query" }),
      });
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.equal(b.step1.status, 402, "step 1 must be a genuine 402");
      assert.equal(b.step3.status, 200, "step 3 must be the paid 200");
      assert.ok(b.step3.body?.result?.query, "live handler payload present");
      assert.match(
        b.step2.headers["X-Channel-Sequence"],
        /^\d+$/,
        "channel seq advertised",
      );
      assert.ok(Number(b.session.consumedLamports) > 0, "spend committed");
    }

    // ── over-cap refusal (session budget envelope) ────────────
    {
      // Drain the remaining budget with expensive MPP dispatches until denied.
      let denied = false;
      for (let i = 0; i < 20; i++) {
        const r = await fetch(`${base}/api/gateway/dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ routeId: "sentiment-x-stream" }),
        });
        if (r.status === 403) {
          const b = await r.json();
          assert.match(b.error, /Insufficient session allowance/i);
          assert.ok(BigInt(b.priceLamports) > BigInt(b.remainingLamports));
          denied = true;
          break;
        }
        if (r.status !== 200) throw new Error(`dispatch gave ${r.status}`);
      }
      assert.equal(denied, true, "over-cap dispatch must be refused with 403");
    }

    // ── settle + settlement log ───────────────────────────────
    {
      const r = await fetch(`${base}/api/channels/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.ok(BigInt(b.settledLamports) >= 0n);
      assert.ok(b.settledLamports.length >= 1);
      assert.match(b.signature, /^[0-9a-f]{88}$/);
    }

    // ── revoke ────────────────────────────────────────────────
    {
      const r = await fetch(`${base}/api/runtime/revoke`, { method: "POST" });
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.equal(b.usage.status, "REVOKED");

      const again = await fetch(`${base}/api/channels/settle`, {
        method: "POST",
      });
      assert.ok([200, 404].includes(again.status));
    }

    // ── persistence across restart (same data dir) ────────────
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }

  // Restart the server on the same data dir; state must be restored.
  const child2 = spawn(process.execPath, [SERVER_JS], {
    env: { ...process.env, PORT: String(port), DASH_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out2 = "";
  child2.stdout.on("data", (c) => (out2 += c.toString()));
  child2.stderr.on("data", (c) => (out2 += c.toString()));
  try {
    // Poll until the restarted server answers; assertions live outside the
    // try/catch so a failing restore is reported as itself, not as a timeout.
    let usage = null;
    for (let i = 0; i < 100 && !usage; i++) {
      try {
        const r = await fetch(`${base}/api/runtime/usage`);
        if (r.ok) usage = await r.json();
      } catch {}
      if (!usage) await new Promise((r) => setTimeout(r, 100));
    }
    if (!usage) throw new Error(`server 2 never ready:\n${out2}`);
    assert.equal(
      usage.status,
      "REVOKED",
      "session status restored from disk",
    );
    assert.ok(
      Number(usage.capLamports) > 0,
      "session cap restored from disk",
    );

    const rc = await fetch(`${base}/api/channels`);
    const rcBody = await rc.json();
    assert.ok(rcBody.channels.length >= 1, "channels restored from disk");
    assert.ok(rcBody.settlements.length >= 1, "settlements restored from disk");

    const rev = await fetch(`${base}/api/gateway/events`);
    const evBody = await rev.json();
    assert.ok(
      evBody.some((e) => e.phase === "paid"),
      "402 event feed restored from disk",
    );
  } catch (err) {
    throw err;
  } finally {
    child2.kill("SIGTERM");
    await new Promise((r) => child2.once("exit", r));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
