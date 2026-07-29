import { useEffect, useState } from "react";
import type { Explain } from "../../core/explain";
import { formatTokens, formatUsd } from "../format";

const SOURCE_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  cursor: "Cursor",
};

const HOW_LABELS: Record<string, string> = {
  exact: "exact match on the model id",
  "stripped-suffix": "matched after stripping the date/variant suffix",
  "provider-prefix": "matched under a provider prefix",
};

/** Exact USD, not rounded to cents — the point of this view is the arithmetic. */
function exactUsd(n: number, digits = 6): string {
  return `$${n.toFixed(digits)}`;
}

function int(n: number): string {
  return n.toLocaleString("en-US");
}

export function ExplainPanel({ query, onClose }: { query: string; onClose: () => void }) {
  const [data, setData] = useState<Explain | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/explain?${query}`)
      .then((r) => r.json())
      .then((d) => alive && setData(d))
      .catch(() => alive && setError("Could not load the breakdown."));
    return () => {
      alive = false;
    };
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-4xl p-5 my-4"
        role="dialog"
        aria-modal="true"
        aria-label="How these numbers are calculated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-1">
          <h2 className="text-lg font-medium">Where these numbers come from</h2>
          <button className="focus-ring text-muted hover:text-text text-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="text-sm text-muted mb-5">
          Every value on the dashboard is derived from files already on your machine. Nothing
          is estimated unless it says so.
        </p>

        {error && <p className="text-sm text-crit">{error}</p>}
        {!data && !error && <p className="text-sm text-muted">Loading…</p>}

        {data && (
          <div className="flex flex-col gap-6">
            <Step
              n={1}
              title="Read the harness's own log files"
              body="We only read. Nothing is ever written, moved, or locked inside your harness directories."
            >
              <div className="flex flex-col gap-3">
                {data.fieldMaps.map((f) => (
                  <div key={f.source} className="rounded border border-border p-3">
                    <div className="flex flex-wrap items-baseline gap-2 mb-1">
                      <span className="text-sm text-text">{SOURCE_LABELS[f.source]}</span>
                      <code className="text-xs text-accent break-all">{f.origin}</code>
                    </div>
                    <p className="text-xs text-muted mb-2">{f.format}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                      {f.fields.map((fd) => (
                        <div key={fd.bucket} className="text-xs flex gap-2">
                          <code className="text-muted shrink-0 w-20">{fd.bucket}</code>
                          <span className="text-muted">←</span>
                          <code className="text-text break-all">{fd.from}</code>
                        </div>
                      ))}
                    </div>
                    {f.caveat && <p className="text-xs text-warn mt-2">{f.caveat}</p>}
                  </div>
                ))}
              </div>
            </Step>

            <Step
              n={2}
              title="Keep the rows inside your selected range"
              body={`${int(data.events.inRange)} messages matched the current filter.`}
            >
              <Table
                head={["Harness", "Messages", "Sessions", "Tokens"]}
                rows={data.events.bySource.map((s) => [
                  SOURCE_LABELS[s.source] ?? s.source,
                  int(s.events),
                  int(s.sessions),
                  int(s.tokens),
                ])}
              />
            </Step>

            <Step
              n={3}
              title="Add up the four token buckets"
              body="The big Tokens number is a plain sum — there is no weighting or scaling."
            >
              <Table
                head={["Bucket", "Tokens", "What it is"]}
                rows={[
                  ["Input", int(data.tokens.in), "Prompt tokens sent fresh"],
                  ["Output", int(data.tokens.out), "Tokens the model generated"],
                  [
                    "Cache write",
                    int(data.tokens.cacheWrite),
                    "Prompt stored for reuse (costs extra once)",
                  ],
                  [
                    "Cache read",
                    int(data.tokens.cacheRead),
                    "Prompt served from cache (much cheaper)",
                  ],
                ]}
              />
              <p className="mt-2 text-sm tabular">
                <span className="text-muted">total = </span>
                {int(data.tokens.in)} + {int(data.tokens.out)} + {int(data.tokens.cacheWrite)} +{" "}
                {int(data.tokens.cacheRead)} ={" "}
                <span className="text-text">{int(data.tokens.total)}</span>
                <span className="text-muted"> ({formatTokens(data.tokens.total)})</span>
              </p>
            </Step>

            <Step
              n={4}
              title="Price each bucket at public list rates"
              body={
                data.rateTable.origin === "litellm-cache"
                  ? `Rates come from the LiteLLM price catalog cached at ${data.rateTable.path} (${int(data.rateTable.models)} models${data.rateTable.loadedAt ? `, updated ${new Date(data.rateTable.loadedAt).toLocaleString()}` : ""}). Hit Refresh to re-fetch.`
                  : `Rates come from the bundled offline fallback (${int(data.rateTable.models)} models). Hit Refresh to fetch the live LiteLLM catalog.`
              }
            >
              <div className="flex flex-col gap-4">
                {data.models.map((m) => (
                  <div key={m.model} className="rounded border border-border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                      <span className="text-sm text-text">{m.model}</span>
                      <span className="text-xs text-muted">
                        {int(m.events)} {m.events === 1 ? "message" : "messages"}
                      </span>
                    </div>
                    {m.priced ? (
                      <p className="text-xs text-muted mb-2">
                        Priced as <code className="text-accent">{m.matchedKey}</code> —{" "}
                        {HOW_LABELS[m.matchedHow ?? "exact"]}.
                      </p>
                    ) : (
                      <p className="text-xs text-warn mb-2">
                        No rate found for this model, so it is counted as $0. Its{" "}
                        {formatTokens(m.tokens.total)} tokens still show up in the token total.
                      </p>
                    )}
                    <Table
                      head={["Bucket", "Tokens", "× rate / 1M", "= cost"]}
                      rows={m.lines.map((l) => [
                        l.derived ? `${l.label} *` : l.label,
                        int(l.tokens),
                        m.priced ? exactUsd(l.ratePerMillion, 2) : "—",
                        exactUsd(l.subtotal),
                      ])}
                    />
                    <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
                      <span className="text-muted">API-equivalent for this model</span>
                      <span className="tabular text-calm">{exactUsd(m.costApi)}</span>
                    </div>
                    {m.lines.some((l) => l.derived) && (
                      <p className="text-xs text-muted mt-2">
                        * The catalog had no explicit cache rate for this model, so it was
                        derived from the input rate (write ×1.25, read ×0.1).
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between text-sm border-t border-border pt-3">
                <span className="text-muted">API-equiv shown on the dashboard</span>
                <span className="tabular text-calm">
                  {exactUsd(data.totals.costApi)}{" "}
                  <span className="text-muted">→ {formatUsd(data.totals.costApi)}</span>
                </span>
              </div>
            </Step>

            <Step
              n={5}
              title="Cache saved, and why Reported can be blank"
              body="Two numbers that are easy to misread."
            >
              <div className="flex flex-col gap-3 text-sm">
                <div className="rounded border border-border p-3">
                  <div className="text-xs metric-label mb-2">Cache saved</div>
                  <p className="text-muted text-xs mb-2">
                    What your {formatTokens(data.tokens.cacheRead)} cached-read tokens would
                    have cost at the full input rate, minus what they actually cost at the
                    cache-read rate.
                  </p>
                  <div className="flex justify-between">
                    <span className="text-muted">saved</span>
                    <span className="tabular text-calm">
                      {exactUsd(data.totals.cacheSavings)}
                    </span>
                  </div>
                </div>
                <div className="rounded border border-border p-3">
                  <div className="text-xs metric-label mb-2">Reported</div>
                  <p className="text-muted text-xs mb-2">
                    The cost the harness recorded itself. {int(data.totals.reportedEvents)} of{" "}
                    {int(data.events.inRange)} messages in this range carried one.
                    {data.totals.costReported == null &&
                      " Since none did, the card shows — rather than a fabricated number."}
                  </p>
                  <div className="flex justify-between">
                    <span className="text-muted">reported</span>
                    <span className="tabular">
                      {data.totals.costReported == null
                        ? "—"
                        : exactUsd(data.totals.costReported)}
                    </span>
                  </div>
                </div>
              </div>
            </Step>

            <p className="text-xs text-muted">
              API-equivalent is a list-price valuation, not a bill. On a subscription you pay a
              flat fee regardless of this number. Want the raw rows behind all of this? Use the
              CSV or JSON export in the header — same filter, one line per message.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  body,
  children,
}: {
  n: number;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="tabular text-xs text-accent shrink-0">{n}</span>
        <h3 className="text-sm text-text">{title}</h3>
      </div>
      <p className="text-xs text-muted mb-3 pl-5">{body}</p>
      <div className="pl-5">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted text-left">
            {head.map((h, i) => (
              <th
                key={h}
                className={`font-normal pb-1 ${i === 0 ? "" : "text-right"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-border">
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className={`py-1.5 ${ci === 0 ? "text-text" : "text-right tabular text-muted"}`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
