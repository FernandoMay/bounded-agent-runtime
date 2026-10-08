import React, { useState } from "react";

const MAX_CAP_CENTS = 10000n;
const DEFAULT_DURATION_MINUTES = 60;

function capDisplay(cents: bigint) {
  const whole = cents / 100n;
  const frac = (cents % 100n);
  const padded = frac.toString().padStart(2, "0");
  return `$${whole}.${padded}`;
}

function statusLabel(status: string) {
  if (status === "ACTIVE") return "Active session";
  if (status === "EXPIRED") return "Expired";
  if (status === "SETTLED") return "Settled";
  return status;
}

export default function App() {
  const [cap, setCap] = useState("1000");
  const [duration, setDuration] = useState(String(DEFAULT_DURATION_MINUTES));
  const [authorized, setAuthorized] = useState(false);
  const [usage, setUsage] = useState<{
    consumed: bigint;
    requests: number;
    status: string;
  } | null>(null);

  const handleAuthorize = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = BigInt(cap) * 100n;
    if (cents > MAX_CAP_CENTS || cents <= 0n) {
      alert(`Cap must be between $0.01 and $100.00`);
      return;
    }
    setAuthorized(true);
    setUsage({
      consumed: 0n,
      requests: 0,
      status: "ACTIVE",
    });
  };

  const handleSettle = () => {
    setUsage((current) =>
      current
        ? { ...current, status: "SETTLED" }
        : null,
    );
  };

  const remaining = usage
    ? MAX_CAP_CENTS - usage.consumed
    : MAX_CAP_CENTS;

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: 40,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <h1>Bounded Agent Runtime</h1>
      <p style={{ color: "#666", marginTop: 4, marginBottom: 24 }}>
        Authorize a bounded spend once, then let the agent pay metered API
        requests through an aggregated settlement channel.
      </p>

      {!authorized ? (
        <form
          onSubmit={handleAuthorize}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 24,
            backgroundColor: "#fafafa",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 16 }}>
            Authorize Agent
          </h2>

          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ fontWeight: 600, marginRight: 8 }}>Cap</span>
            <span style={{ color: "#666" }}>Maximum spend for this session</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="number"
                min="1"
                max="10000"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                style={{
                  width: 120,
                  padding: "8px 10px",
                  fontSize: 16,
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                }}
              />
              <span style={{ color: "#666" }}>USD</span>
            </div>
          </label>

          <label style={{ display: "block", marginBottom: 20 }}>
            <span style={{ fontWeight: 600, marginRight: 8 }}>
              Duration
            </span>
            <span style={{ color: "#666" }}>
              Session lifetime in minutes
            </span>
            <input
              type="number"
              min="1"
              max="1440"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              style={{
                width: 120,
                padding: "8px 10px",
                fontSize: 16,
                borderRadius: 8,
                border: "1px solid #d1d5db",
              }}
            />
          </label>

          <button
            type="submit"
            style={{
              width: "100%",
              padding: "12px 16px",
              fontSize: 16,
              fontWeight: 600,
              color: "#fff",
              backgroundColor: "#1d4ed8",
              border: "none",
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            Authorize
          </button>

          <p style={{ color: "#777", fontSize: 13, marginTop: 16 }}>
            One signature authorizes the agent to spend from this allowance
            across paid APIs until the cap or duration is reached.
          </p>
        </form>
      ) : (
        <section
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h2>Session</h2>
            <span
              style={{
                fontWeight: 600,
                color:
                  usage?.status === "SETTLED" ? "#92400e" : "#16a34a",
              }}
            >
              {statusLabel(usage?.status ?? "ACTIVE")}
            </span>
          </div>

          <div
            style={{
              marginTop: 16,
              padding: 16,
              backgroundColor: "#f3f4f6",
              borderRadius: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Cap</span>
              <span style={{ fontWeight: 600 }}>{capDisplay(MAX_CAP_CENTS)}</span>
            </div>
            <div
              style={{
                marginTop: 10,
                borderTop: "1px solid #d1d5db",
                paddingTop: 10,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Spent</span>
              <span style={{ color: "#b91c1c" }}>
                {capDisplay(usage?.consumed ?? 0n)}
              </span>
            </div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Remaining</span>
              <span style={{ fontWeight: 600 }}>
                {capDisplay(remaining)}
              </span>
            </div>
            <div
              style={{
                marginTop: 10,
                borderTop: "1px solid #d1d5db",
                paddingTop: 10,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Requests</span>
              <span style={{ fontWeight: 600 }}>{usage?.requests ?? 0}</span>
            </div>
          </div>

          <div
            style={{
              marginTop: 16,
              display: "flex",
              gap: 12,
              alignItems: "center",
            }}
          >
            <button
              disabled={usage?.status === "SETTLED"}
              onClick={handleSettle}
              style={{
                padding: "10px 18px",
                fontSize: 15,
                fontWeight: 600,
                color: "#fff",
                backgroundColor: "#1d4ed8",
                border: "none",
                borderRadius: 8,
                cursor: usage?.status === "SETTLED" ? "not-allowed" : "pointer",
                opacity: usage?.status === "SETTLED" ? 0.6 : 1,
              }}
            >
              Settle Channel
            </button>
            <button
              onClick={() => {
                setAuthorized(false);
                setUsage(null);
              }}
              style={{
                padding: "10px 18px",
                fontSize: 15,
                fontWeight: 600,
                color: "#1d4ed8",
                backgroundColor: "#fff",
                border: "1px solid #1d4ed8",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              New Session
            </button>
          </div>

          <p style={{ color: "#666", fontSize: 13, marginTop: 16 }}>
            Settlement aggregates all micro-payments from the session into a
            single final transaction.
          </p>
        </section>
      )}

      <hr style={{ margin: "40px 0", border: "none", borderTop: "1px solid #e5e7eb" }} />

      <footer style={{ color: "#777", fontSize: 13 }}>
        <p>
          Local demo architecture:{" "}
          <code style={{ backgroundColor: "#f3f4f6", padding: "2px 6px", borderRadius: 4 }}>
            Allowance → Private Balance → Agent → MPP/x402 → Payment Channel
            → Settlement
          </code>
        </p>
      </footer>
    </main>
  );
}
