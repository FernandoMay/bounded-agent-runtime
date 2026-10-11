/**
 * Boundia Runtime Node — shared UI controller.
 *
 * One file drives all four pages. It reads `document.body.dataset.page` to
 * know which page mounted, then wires that page's controls to the real REST
 * API in server.ts. Every value rendered here comes from a live request —
 * nothing is hardcoded mock data.
 */

const API = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || `${path} → ${res.status}`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  },
};

// ── helpers ────────────────────────────────────────────────────────────────

const LAMPORTS_PER_SOL = 1_000_000_000;

function lamportsToSol(lamports) {
  return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(3);
}

function usdCentsToDisplay(cents) {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return `$${whole}.${frac}`;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setWidth(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function setAttr(id, attr, value) {
  const el = document.getElementById(id);
  if (el) el.setAttribute(attr, value);
}

function toast(message, isError = false) {
  const el = document.getElementById("toast");
  const msg = document.getElementById("toast-message");
  const icon = document.getElementById("toastIcon");
  if (!el || !msg) return;
  msg.textContent = message;
  if (icon) {
    icon.textContent = isError ? "error" : "check_circle";
    icon.className =
      "material-symbols-outlined " + (isError ? "text-error" : "text-secondary");
  }
  el.classList.remove("translate-y-20", "translate-y-24", "opacity-0", "pointer-events-none");
  el.classList.add("translate-y-0", "opacity-100");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.classList.add("translate-y-20", "translate-y-24", "opacity-0", "pointer-events-none");
    el.classList.remove("translate-y-0", "opacity-100");
  }, 3600);
}

function toggleModal(id, show) {
  const modal = document.getElementById(id);
  if (!modal) return;
  const hidden =
    modal.classList.contains("hidden") ||
    modal.classList.contains("pointer-events-none");
  const want = show ?? hidden;
  if (want) {
    modal.classList.remove("hidden", "pointer-events-none", "opacity-0");
  } else {
    modal.classList.add("hidden", "pointer-events-none", "opacity-0");
  }
}

function timeStr(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `[${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}]`;
}

// Expose modal/toast toggles to inline onclick handlers in the HTML.
window.toggleModal = toggleModal;
window.showToast = toast;

// ── shared header allowance meter (every page) ─────────────────────────────

async function refreshSessionMeter() {
  try {
    const usage = await API.get("/api/runtime/usage");
    if (!usage.active && usage.status === "NONE") {
      setText("header-allowance", "No session");
      setWidth("header-allowance-bar", 0);
      return usage;
    }
    setText(
      "header-allowance",
      `Spent ${lamportsToSol(usage.consumedLamports)} / ${lamportsToSol(usage.capLamports)} SOL`,
    );
    setWidth("header-allowance-bar", usage.spentPct);
    return usage;
  } catch {
    setText("header-allowance", "API offline");
    return null;
  }
}

// ── page: overview-runtime ─────────────────────────────────────────────────

async function initOverview() {
  await refreshSessionMeter();

  try {
    const stats = await API.get("/api/gateway/stats");
    setText("kpi-dispatches", stats.totalDispatches.toLocaleString());
    setText("kpi-channels", String(stats.openChannels));
    setText("kpi-latency", `${stats.avgHandshakeLatencyMs}ms`);
  } catch {
    /* ignore */
  }

  try {
    const usage = await API.get("/api/runtime/usage");
    setText("spent-disp", `${lamportsToSol(usage.consumedLamports)} SOL`);
    setText("cap-disp", `${lamportsToSol(usage.capLamports)} SOL`);
    setText("remain-disp", `${lamportsToSol(usage.remainingLamports)} SOL`);
    setWidth("gauge-bar", usage.spentPct);
    setText("session-status", usage.status);
  } catch {
    /* ignore */
  }

  try {
    const { channels } = await API.get("/api/channels");
    renderChannelRows(channels);
  } catch {
    /* ignore */
  }

  try {
    const ledger = await API.get("/api/boundia/ledger");
    renderEvidenceRows(ledger);
  } catch {
    /* ignore */
  }

  try {
    const events = await API.get("/api/gateway/events");
    renderEventFeed(events);
  } catch {
    /* ignore */
  }

  wireOverviewControls();
}

function renderChannelRows(channels) {
  const tbody = document.getElementById("channels-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!channels.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="py-6 px-4 text-center text-text-muted font-code-mono-sm">No channels yet — dispatch a paid request to open one.</td></tr>';
    return;
  }
  for (const ch of channels) {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-surface-container/60 transition-colors";
    const statusColor =
      ch.status === "OPEN" ? "bg-secondary/10 text-secondary" : "bg-status-settled/10 text-status-settled";
    tr.innerHTML = `
      <td class="py-4 px-4">
        <div class="flex flex-col">
          <span class="font-code-mono text-code-mono font-bold text-primary">${ch.id}</span>
          <span class="font-body-base text-body-base text-text-secondary">${ch.counterparty}</span>
          <span class="font-code-mono-sm text-code-mono-sm text-text-muted">${ch.endpoint}</span>
        </div>
      </td>
      <td class="py-4 px-4 font-code-mono text-code-mono-sm"><span class="px-2 py-0.5 rounded bg-surface-container text-primary font-bold">${ch.protocol}</span></td>
      <td class="py-4 px-4 font-code-mono text-code-mono"><span class="text-on-surface font-bold">${lamportsToSol(ch.pendingLamports)} SOL</span></td>
      <td class="py-4 px-4 font-code-mono text-code-mono"><span class="text-on-surface">${ch.microTxCount}</span></td>
      <td class="py-4 px-4"><span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${statusColor}"><span class="w-2 h-2 rounded-full bg-current"></span><span class="font-label-caps text-label-caps uppercase font-bold">${ch.status}</span></span></td>
      <td class="py-4 px-4 text-right"><button class="px-2.5 py-1 rounded-md bg-surface-container text-status-settled hover:bg-surface-container-high font-code-mono-sm text-code-mono-sm" data-settle="${ch.id}">Settle</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("[data-settle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const r = await API.post("/api/channels/settle", { id: btn.dataset.settle });
        toast(`Settled ${lamportsToSol(r.settledLamports)} SOL · tx ${r.signature.slice(0, 12)}…`);
        initOverview();
      } catch (e) {
        toast(e.message, true);
      }
    });
  });
}

function renderEvidenceRows(ledger) {
  const box = document.getElementById("evidence-log");
  if (!box) return;
  box.innerHTML = "";
  if (!ledger.length) {
    box.innerHTML =
      '<div class="text-text-muted font-code-mono-sm p-3">No cross-chain evidence yet — run a Boundia adapter op.</div>';
    return;
  }
  for (const e of ledger.slice(-6).reverse()) {
    const row = document.createElement("div");
    row.className =
      "p-space-sm rounded bg-surface-container flex items-center justify-between font-code-mono-sm text-code-mono-sm";
    row.innerHTML = `
      <span class="${e.status === "completed" ? "text-secondary" : "text-error"} uppercase font-bold">${e.status}</span>
      <span class="text-text-primary">${e.chain}/${e.operation}</span>
      <span class="text-text-muted truncate max-w-[180px]">${e.reference ?? "—"}</span>`;
    box.appendChild(row);
  }
}

function renderEventFeed(events) {
  const stream = document.getElementById("dynamic-log-stream");
  if (!stream) return;
  stream.innerHTML = "";
  for (const evt of events.slice(0, 25)) {
    const row = document.createElement("div");
    row.className = "flex items-start gap-2 text-text-muted";
    const cls =
      evt.phase === "paid"
        ? "text-secondary"
        : evt.phase === "denied"
          ? "text-error"
          : "text-status-settled";
    row.innerHTML = `
      <span class="text-text-muted whitespace-nowrap">${timeStr(evt.at)}</span>
      <span class="${cls} font-bold">${evt.status}</span>
      <span class="text-text-primary">${evt.method} ${evt.path}</span>
      <span class="text-text-muted">(${lamportsToSol(evt.costLamports)} SOL · ${evt.latencyMs}ms) ${evt.detail}</span>`;
    stream.appendChild(row);
  }
}

function wireOverviewControls() {
  const settleAll = document.getElementById("settle-all-btn");
  if (settleAll && !settleAll._wired) {
    settleAll._wired = true;
    settleAll.addEventListener("click", async () => {
      try {
        const r = await API.post("/api/runtime/settle");
        toast(`Session settled · ${lamportsToSol(r.settledLamports)} SOL aggregated`);
        initOverview();
      } catch (e) {
        toast(e.message, true);
      }
    });
  }
  const revoke = document.getElementById("execute-revoke-btn");
  if (revoke && !revoke._wired) {
    revoke._wired = true;
    revoke.addEventListener("click", async () => {
      try {
        await API.post("/api/runtime/revoke");
        toggleModal("revoke-modal", false);
        toast("Emergency halt executed — runtime suspended.", true);
        initOverview();
      } catch (e) {
        toast(e.message, true);
      }
    });
  }
  const saveCap = document.getElementById("save-allowance-btn");
  if (saveCap && !saveCap._wired) {
    saveCap._wired = true;
    saveCap.addEventListener("click", async () => {
      const input = document.getElementById("cap-input-val");
      const capCents = Math.round(parseFloat(input?.value || "0") * 100);
      try {
        await API.post("/api/runtime/authorize", { capCents, durationMinutes: 60 });
        toggleModal("allowance-modal", false);
        toast(`Allowance updated → ${usdCentsToDisplay(capCents)}`);
        initOverview();
      } catch (e) {
        toast(e.message, true);
      }
    });
  }
}

// ── page: allowance-spend-policies ─────────────────────────────────────────

async function initAllowance() {
  await refreshSessionMeter();

  try {
    const policy = await API.get("/api/policy");
    const chains = policy.chains;
    setText("policy-solana-budget", `${lamportsToSol(chains.solana.budgetAtomic)} SOL`);
    setText("policy-hl-budget", chains.hyperliquid.budgetAtomic);
    setText("policy-arb-budget", chains.arbitrum.budgetAtomic);
    setText("policy-zec-budget", chains.zcash.budgetAtomic);
    setText("policy-ledger-size", String(policy.ledgerSize));
  } catch {
    /* ignore */
  }

  const slider = document.getElementById("ceiling-slider");
  const display = document.getElementById("ceiling-val-display");
  const preview = document.getElementById("modal-ceiling-preview");
  if (slider && display) {
    slider.addEventListener("input", () => {
      const v = parseFloat(slider.value).toFixed(3);
      display.textContent = `${v} SOL`;
      if (preview) preview.textContent = `${v} SOL`;
    });
  }

  const trigger = document.getElementById("trigger-auth-btn");
  if (trigger) trigger.addEventListener("click", () => toggleModal("auth-modal", true));
  const close = document.getElementById("close-modal-btn");
  if (close) close.addEventListener("click", () => toggleModal("auth-modal", false));
  const cancel = document.getElementById("cancel-modal-btn");
  if (cancel) cancel.addEventListener("click", () => toggleModal("auth-modal", false));

  const confirmBtn = document.getElementById("confirm-sign-btn");
  if (confirmBtn && !confirmBtn._wired) {
    confirmBtn._wired = true;
    confirmBtn.addEventListener("click", async () => {
      const status = document.getElementById("sign-status");
      if (status) {
        status.classList.remove("hidden");
        status.textContent = "Committing policy to Boundia PolicyEngine…";
      }
      const ceilSol = parseFloat(slider?.value ?? "0.025");
      const capCents = Math.max(1, Math.round(ceilSol * 1000));
      try {
        await API.post("/api/runtime/authorize", { capCents, durationMinutes: 60 });
        if (status) status.textContent = "Policy committed. Session budget updated.";
        toast("Policy committed to Boundia PolicyEngine.");
        setTimeout(() => toggleModal("auth-modal", false), 900);
      } catch (e) {
        if (status) status.textContent = `Failed: ${e.message}`;
        toast(e.message, true);
      }
    });
  }
}

// ── page: provider-402-gateway ─────────────────────────────────────────────

async function initGateway() {
  await refreshSessionMeter();

  let routes = [];
  try {
    routes = await API.get("/api/gateway/routes");
    renderRouteCatalog(routes);
  } catch {
    /* ignore */
  }

  const select = document.getElementById("simRoute");
  if (select && !select._wired) {
    select._wired = true;
    select.innerHTML = "";
    for (const r of routes) {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = `${r.method} ${r.path} — ${(Number(r.priceLamports) / 1e9).toFixed(3)} SOL`;
      select.appendChild(opt);
    }
  }

  const runBtn = document.getElementById("runSimulationBtn");
  if (runBtn && !runBtn._wired) {
    runBtn._wired = true;
    runBtn.addEventListener("click", () => dispatchReal());
  }
}

function renderRouteCatalog(routes) {
  const tbody = document.getElementById("routes-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const r of routes) {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-surface-container transition-colors";
    const status = r.active
      ? '<span class="inline-flex items-center gap-1.5 px-space-sm py-0.5 rounded-full bg-surface-container text-secondary-fixed font-label-caps text-label-caps"><span class="w-1.5 h-1.5 rounded-full bg-secondary-fixed"></span> LIVE</span>'
      : '<span class="inline-flex items-center gap-1.5 px-space-sm py-0.5 rounded-full bg-surface-container text-text-muted font-label-caps text-label-caps"><span class="w-1.5 h-1.5 rounded-full bg-text-muted"></span> IDLE</span>';
    tr.innerHTML = `
      <td class="py-space-md px-space-md font-code-mono text-code-mono text-text-primary">${r.path}</td>
      <td class="py-space-md px-space-md font-code-mono text-code-mono text-primary font-bold">${r.method}</td>
      <td class="py-space-md px-space-md font-code-mono text-code-mono text-text-primary">${(Number(r.priceLamports) / 1e9).toFixed(3)} SOL</td>
      <td class="py-space-md px-space-md font-code-mono text-code-mono text-secondary-fixed">${r.microTxCount}</td>
      <td class="py-space-md px-space-md"><span class="px-2 py-0.5 rounded bg-surface-container text-primary font-label-caps text-label-caps uppercase">${r.protocol}</span></td>
      <td class="py-space-md px-space-md">${status}</td>`;
    tbody.appendChild(tr);
  }
}

async function dispatchReal() {
  const select = document.getElementById("simRoute");
  const btnText = document.getElementById("btnText");
  const btnIcon = document.getElementById("btnIcon");
  const simLabel = document.getElementById("simStateLabel");
  const routeId = select?.value ?? "research-query";
  if (!routeId) return;

  const setStep = (n) => window.switchStep?.(n);

  btnText.innerText = "Step 1: Requesting resource (expect 402)…";
  btnIcon.innerText = "hourglass_top";
  simLabel.innerText = "AWAITING_402_CHALLENGE";
  simLabel.className = "text-status-settled font-bold";
  setStep(1);

  try {
    const payload = {};
    const payloadBox = document.getElementById("simPayload");
    if (payloadBox) {
      try {
        Object.assign(payload, JSON.parse(payloadBox.textContent));
      } catch {
        /* ignore */
      }
    }

    const r = await API.post("/api/gateway/dispatch", { routeId, payload });

    await sleep(400);
    btnText.innerText = "Step 2: Minting channel voucher…";
    btnIcon.innerText = "key";
    simLabel.innerText = "SOLANA_ED25519_SIGNING";
    simLabel.className = "text-primary font-bold";
    setStep(2);
    fillStep2(r);

    await sleep(500);
    btnText.innerText = `Step 3: ${r.step3.status} OK — settled in channel`;
    btnIcon.innerText = "check_circle";
    simLabel.innerText = `SETTLED_${r.channel.id.toUpperCase()}`;
    simLabel.className = "text-secondary-fixed font-bold";
    setStep(3);
    fillStep3(r);

    toast(`Paid ${(Number(r.step2.headers["X-Channel-Lamports-Committed"]) / 1e9).toFixed(4)} SOL · seq #${r.channel.seq}`);
    refreshSessionMeter();
    // Refresh route table counts.
    API.get("/api/gateway/routes").then(renderRouteCatalog).catch(() => {});
  } catch (e) {
    btnText.innerText = "Dispatch failed";
    btnIcon.innerText = "error";
    simLabel.innerText = "DENIED";
    simLabel.className = "text-error font-bold";
    toast(e.message, true);
  } finally {
    setTimeout(() => {
      btnText.innerText = "Dispatch Agent Request";
      btnIcon.innerText = "bolt";
    }, 2400);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fillStep2(r) {
  const box = document.getElementById("step2-headers");
  if (!box) return;
  box.innerHTML = Object.entries(r.step2.headers)
    .map(([k, v]) => `<div><span class="text-text-muted">&gt; ${k}:</span> <span class="text-secondary-fixed font-bold">${v}</span></div>`)
    .join("");
}

function fillStep3(r) {
  const statusEl = document.getElementById("step3-status");
  if (statusEl) statusEl.textContent = `${r.step3.status} ${r.step3.statusText}`;
  const headers = document.getElementById("step3-headers");
  if (headers) {
    headers.innerHTML = Object.entries(r.step3.headers)
      .map(([k, v]) => `<div><span class="text-text-muted">&lt; ${k}:</span> <span class="text-primary">${v}</span></div>`)
      .join("");
  }
  const body = document.getElementById("step3-body");
  if (body) body.textContent = JSON.stringify(r.step3.body, null, 2);
}

// ── page: settlement-channels ──────────────────────────────────────────────

async function initSettlement() {
  await refreshSessionMeter();

  try {
    const { channels, settlements } = await API.get("/api/channels");
    renderSettlementChannels(channels);
    renderSettlementLog(settlements);
    const totalPending = channels.reduce((a, c) => a + Number(c.pendingLamports), 0);
    setText("float-pending", `${lamportsToSol(String(totalPending))}`);
    setText("active-channel-count", String(channels.length));
  } catch {
    /* ignore */
  }

  const flush = document.getElementById("batchSettleBtn");
  if (flush && !flush._wired) {
    flush._wired = true;
    flush.addEventListener("click", async () => {
      flush.classList.add("opacity-70");
      const original = flush.innerHTML;
      flush.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span> Broadcasting…';
      try {
        const r = await API.post("/api/channels/settle");
        toast(`Micro-batch settled · ${lamportsToSol(r.settledLamports)} SOL`);
        initSettlement();
      } catch (e) {
        toast(e.message, true);
      } finally {
        flush.classList.remove("opacity-70");
        flush.innerHTML = original;
      }
    });
  }
}

function renderSettlementChannels(channels) {
  const tbody = document.getElementById("settlement-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!channels.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="py-8 text-center text-text-muted font-code-mono">No channels established yet.</td></tr>';
    return;
  }
  for (const ch of channels) {
    const pct = ch.usedPct.toFixed(1);
    const low = ch.usedPct > 90;
    const tr = document.createElement("tr");
    tr.className = "hover:bg-surface-container/60 transition-colors";
    tr.innerHTML = `
      <td class="py-space-md px-space-lg">
        <div class="flex flex-col">
          <span class="font-code-mono text-code-mono font-bold text-primary">${ch.id}</span>
          <span class="font-body-base text-body-base text-text-secondary">${ch.counterparty}</span>
          <span class="font-code-mono-sm text-code-mono-sm text-text-muted">${ch.endpoint}</span>
        </div>
      </td>
      <td class="py-space-md px-space-md font-code-mono text-code-mono"><span class="text-text-primary font-bold">${lamportsToSol(ch.capacityLamports)} SOL</span></td>
      <td class="py-space-md px-space-md">
        <div class="flex flex-col gap-1 w-40">
          <div class="flex justify-between font-code-mono-sm text-code-mono-sm">
            <span class="${low ? "text-error font-bold" : "text-primary font-bold"}">${lamportsToSol(ch.pendingLamports)} SOL</span>
            <span class="text-text-muted">${pct}%</span>
          </div>
          <div class="w-full bg-surface-container-highest rounded-full h-1.5 overflow-hidden">
            <div class="${low ? "bg-status-settled" : "bg-primary"} h-full rounded-full" style="width:${pct}%"></div>
          </div>
          ${low ? '<span class="font-code-mono-sm text-[10px] text-error font-bold">LOW RESERVE</span>' : ""}
        </div>
      </td>
      <td class="py-space-md px-space-md font-code-mono text-code-mono text-text-primary"><span class="px-2 py-0.5 rounded bg-surface-container font-bold text-primary-fixed-dim">#${ch.microTxCount}</span></td>
      <td class="py-space-md px-space-md font-code-mono-sm text-code-mono-sm text-text-secondary">${ch.lastSignature ? "Sig: " + ch.lastSignature.slice(0, 10) + "…" : "—"}</td>
      <td class="py-space-md px-space-md"><span class="px-2 py-0.5 rounded-full bg-surface-container font-code-mono-sm text-code-mono-sm text-secondary">${ch.status}</span></td>
      <td class="py-space-md px-space-lg text-right">
        <button class="px-2.5 py-1 rounded bg-secondary-container/10 text-secondary hover:bg-secondary-container/20 font-code-mono-sm text-code-mono-sm font-bold" data-settle="${ch.id}">Settle On-Chain</button>
      </td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("[data-settle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const r = await API.post("/api/channels/settle", { id: btn.dataset.settle });
        toast(`Settled ${lamportsToSol(r.settledLamports)} SOL`);
        initSettlement();
      } catch (e) {
        toast(e.message, true);
      }
    });
  });
}

function renderSettlementLog(settlements) {
  const box = document.getElementById("settlement-log");
  if (!box) return;
  box.innerHTML = "";
  if (!settlements.length) {
    box.innerHTML = '<div class="text-text-muted font-code-mono-sm p-3">No settlements yet.</div>';
    return;
  }
  for (const s of settlements.slice(0, 5)) {
    const row = document.createElement("div");
    row.className =
      "p-space-md rounded-xl bg-surface-container-high flex flex-col gap-1 font-code-mono-sm text-code-mono-sm hover:bg-surface-highlight transition-colors";
    row.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-space-xs">
          <span class="px-1.5 py-0.5 rounded bg-secondary-container/20 text-secondary font-bold">${timeStr(s.at)}</span>
          <span class="text-text-primary font-bold">Disbursed: ${lamportsToSol(s.amountLamports)} SOL</span>
        </div>
        <span class="text-text-muted">${s.microTxCount} micro-tx</span>
      </div>
      <div class="flex flex-col pt-1 text-text-secondary">
        <span class="text-text-muted text-[10px] uppercase">Transaction Signature:</span>
        <span class="text-primary truncate">${s.signature}</span>
      </div>`;
    box.appendChild(row);
  }
}

// ── boot ───────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "overview-runtime") initOverview();
  else if (page === "allowance-spend-policies") initAllowance();
  else if (page === "provider-402-gateway") initGateway();
  else if (page === "settlement-channels") initSettlement();
  else refreshSessionMeter();
});
