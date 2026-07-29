import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { FilterPreset, Source } from "../adapters/types";
import { formatTokens, formatUsd } from "./format";
import { InfoTip } from "./components/InfoTip";

type LedgerRow = {
  id: string;
  ts: number;
  source: Source;
  model: string;
  sessionId: string;
  project: string | null;
  tokens: { in: number; out: number; cacheWrite: number; cacheRead: number; total: number };
  priced: boolean;
  matchedKey: string | null;
  costParts: { in: number; out: number; cacheWrite: number; cacheRead: number };
  costApi: number;
  costApiStored: number;
  costReported: number | null;
};

type Payload = {
  totals: {
    rows: number;
    tokens: number;
    costApi: number;
    costReported: number | null;
    reportedRows: number;
  };
  models: string[];
  records: LedgerRow[];
};

type Sort = "ts" | "cost" | "tokens" | "model" | "source";

const PRESETS: FilterPreset[] = ["today", "week", "month", "all"];
const ALL_SOURCES: Source[] = ["claude-code", "opencode", "cursor"];
const SOURCE_LABELS: Record<Source, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  cursor: "Cursor",
};

const PAGE_SIZES = [50, 100, 250];

function exactUsd(n: number, digits = 6) {
  return `$${n.toFixed(digits)}`;
}
function int(n: number) {
  return n.toLocaleString("en-US");
}
function fmtTs(ts: number) {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function RecordsView() {
  const [preset, setPreset] = useState<FilterPreset>("today");
  const [sources, setSources] = useState<Source[]>([]);
  const [model, setModel] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort>("ts");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  // Any change to the filter invalidates the current page offset.
  useEffect(() => {
    setOffset(0);
  }, [preset, sources, model, debounced, limit]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("preset", preset);
    if (sources.length) p.set("sources", sources.join(","));
    if (model) p.set("models", model);
    if (debounced) p.set("q", debounced);
    p.set("sort", sort);
    p.set("dir", dir);
    p.set("limit", String(limit));
    p.set("offset", String(offset));
    return p.toString();
  }, [preset, sources, model, debounced, sort, dir, limit, offset]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/records?${query}`).then((x) => x.json());
    setData(r);
    setLoading(false);
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSort(next: Sort) {
    if (sort === next) {
      setDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSort(next);
      setDir(next === "model" || next === "source" ? "asc" : "desc");
    }
    setOffset(0);
  }

  function toggleSource(s: Source) {
    setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  const total = data?.totals.rows ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  // Export must carry the same filter, minus the paging params.
  const exportQuery = useMemo(() => {
    const p = new URLSearchParams(query);
    p.delete("limit");
    p.delete("offset");
    p.delete("sort");
    p.delete("dir");
    return p.toString();
  }, [query]);

  return (
    <div className="min-h-screen px-4 py-5 md:px-8 md:py-6 max-w-[1600px] mx-auto">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Records</h1>
            <InfoTip
              align="left"
              text="Every individual message read from your harness log files, one row each, with the cost arithmetic behind it. This is the raw ledger the dashboard aggregates."
            />
          </div>
          <p className="text-sm text-muted mt-0.5">
            Raw rows as ingested, straight from each source
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a className="focus-ring text-xs text-accent px-2 hover:underline" href="/">
            ← Dashboard
          </a>
          <a
            className="focus-ring text-xs text-accent px-2"
            href={`/api/export?format=csv&${exportQuery}`}
          >
            CSV
          </a>
          <a
            className="focus-ring text-xs text-accent px-2"
            href={`/api/export?format=json&${exportQuery}`}
          >
            JSON
          </a>
        </div>
      </header>

      <section className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block metric-label mb-1.5">Range</label>
          <div className="flex rounded-md border border-border overflow-hidden">
            {PRESETS.map((p) => (
              <button
                key={p}
                className={`focus-ring px-3 py-1.5 text-xs capitalize transition-colors duration-150 ${
                  preset === p ? "bg-accent/20 text-text" : "text-muted hover:text-text"
                }`}
                onClick={() => setPreset(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block metric-label mb-1.5">Harness</label>
          <div className="flex gap-1.5">
            {ALL_SOURCES.map((s) => {
              const active = sources.length === 0 || sources.includes(s);
              return (
                <button
                  key={s}
                  className={`focus-ring text-xs px-2 py-1.5 rounded border transition-colors duration-150 ${
                    active ? "border-accent/50 text-text" : "border-border text-muted opacity-60"
                  }`}
                  onClick={() => toggleSource(s)}
                >
                  {SOURCE_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block metric-label mb-1.5" htmlFor="model">
            Model
          </label>
          <select
            id="model"
            className="focus-ring bg-bg border border-border rounded px-2 py-1.5 text-xs min-w-40"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">All models</option>
            {(data?.models ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-48">
          <label className="block metric-label mb-1.5" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            className="focus-ring w-full bg-bg border border-border rounded px-2 py-1.5 text-xs"
            placeholder="model, session id or project path"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div>
          <label className="block metric-label mb-1.5" htmlFor="size">
            Rows
          </label>
          <select
            id="size"
            className="focus-ring bg-bg border border-border rounded px-2 py-1.5 text-xs"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Rows matched" value={int(data?.totals.rows ?? 0)} />
        <Stat
          label="Tokens"
          value={formatTokens(data?.totals.tokens ?? 0)}
          sub={int(data?.totals.tokens ?? 0)}
        />
        <Stat
          label="API-equiv"
          value={formatUsd(data?.totals.costApi ?? 0)}
          sub={exactUsd(data?.totals.costApi ?? 0)}
          tone="calm"
        />
        <Stat
          label="Reported"
          value={
            data?.totals.costReported == null ? "—" : formatUsd(data.totals.costReported)
          }
          sub={`${int(data?.totals.reportedRows ?? 0)} of ${int(data?.totals.rows ?? 0)} rows`}
        />
      </section>

      <div className="card overflow-hidden mb-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted text-left border-b border-border">
                <Th onClick={() => toggleSort("ts")} active={sort === "ts"} dir={dir}>
                  When
                </Th>
                <Th onClick={() => toggleSort("source")} active={sort === "source"} dir={dir}>
                  Harness
                </Th>
                <Th onClick={() => toggleSort("model")} active={sort === "model"} dir={dir}>
                  Model
                </Th>
                <Th align="right">In</Th>
                <Th align="right">Out</Th>
                <Th align="right">Cache w</Th>
                <Th align="right">Cache r</Th>
                <Th
                  align="right"
                  onClick={() => toggleSort("tokens")}
                  active={sort === "tokens"}
                  dir={dir}
                >
                  Tokens
                </Th>
                <Th
                  align="right"
                  onClick={() => toggleSort("cost")}
                  active={sort === "cost"}
                  dir={dir}
                >
                  API-equiv
                </Th>
                <Th align="right">Reported</Th>
              </tr>
            </thead>
            <tbody>
              {(data?.records ?? []).map((r) => {
                const open = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className={`border-b border-border cursor-pointer hover:bg-accent/5 ${
                        open ? "bg-accent/5" : ""
                      }`}
                      onClick={() => setExpanded(open ? null : r.id)}
                    >
                      <td className="py-1.5 px-3 tabular whitespace-nowrap">{fmtTs(r.ts)}</td>
                      <td className="py-1.5 px-3 whitespace-nowrap">
                        {SOURCE_LABELS[r.source]}
                      </td>
                      <td className="py-1.5 px-3 whitespace-nowrap">
                        {r.model}
                        {!r.priced && (
                          <span className="text-warn ml-1" title="No rate found — counted as $0">
                            •
                          </span>
                        )}
                      </td>
                      <Td>{int(r.tokens.in)}</Td>
                      <Td>{int(r.tokens.out)}</Td>
                      <Td>{int(r.tokens.cacheWrite)}</Td>
                      <Td>{int(r.tokens.cacheRead)}</Td>
                      <Td className="text-text">{int(r.tokens.total)}</Td>
                      <Td className="text-calm">{exactUsd(r.costApi)}</Td>
                      <Td>{r.costReported == null ? "—" : exactUsd(r.costReported)}</Td>
                    </tr>
                    {open && (
                      <tr className="border-b border-border bg-bg/40">
                        <td colSpan={10} className="px-3 py-3">
                          <RowDetail r={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!loading && (data?.records.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-muted">
                    No rows match this filter.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <p className="text-xs text-muted tabular">
          {total === 0 ? "No rows" : `${int(from)}–${int(to)} of ${int(total)}`}
        </p>
        <div className="flex gap-2">
          <button
            className="focus-ring text-xs px-3 py-1.5 rounded border border-border text-muted hover:text-text disabled:opacity-40 disabled:hover:text-muted"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - limit))}
          >
            Previous
          </button>
          <button
            className="focus-ring text-xs px-3 py-1.5 rounded border border-border text-muted hover:text-text disabled:opacity-40 disabled:hover:text-muted"
            disabled={to >= total}
            onClick={() => setOffset((o) => o + limit)}
          >
            Next
          </button>
        </div>
      </div>

      <footer className="text-xs text-muted border-t border-border pt-4 pb-8">
        Click any row to see how its cost was computed. API-equivalent is a list-price
        valuation, not a bill. Read-only on harness data. Zero telemetry.
      </footer>
    </div>
  );
}

function RowDetail({ r }: { r: LedgerRow }) {
  const drift = Math.abs(r.costApi - r.costApiStored) > 1e-9;
  const lines = [
    { label: "Input", tokens: r.tokens.in, cost: r.costParts.in },
    { label: "Output", tokens: r.tokens.out, cost: r.costParts.out },
    { label: "Cache write", tokens: r.tokens.cacheWrite, cost: r.costParts.cacheWrite },
    { label: "Cache read", tokens: r.tokens.cacheRead, cost: r.costParts.cacheRead },
  ];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="metric-label mb-2">Cost breakdown</div>
        <table className="w-full text-xs">
          <tbody>
            {lines.map((l) => (
              <tr key={l.label} className="border-t border-border">
                <td className="py-1 text-muted">{l.label}</td>
                <td className="py-1 text-right tabular text-muted">{int(l.tokens)}</td>
                <td className="py-1 text-right tabular">
                  {l.tokens === 0 ? "—" : exactUsd(l.cost)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-border">
              <td className="py-1 text-text" colSpan={2}>
                Total
              </td>
              <td className="py-1 text-right tabular text-calm">{exactUsd(r.costApi)}</td>
            </tr>
          </tbody>
        </table>
        {r.priced ? (
          <p className="text-xs text-muted mt-2">
            Priced as <code className="text-accent">{r.matchedKey}</code>.
          </p>
        ) : (
          <p className="text-xs text-warn mt-2">
            No rate found for <code>{r.model}</code> — this row counts as $0, but its tokens
            still count.
          </p>
        )}
        {drift && (
          <p className="text-xs text-warn mt-2">
            Stored at ingest as {exactUsd(r.costApiStored)}. The rate table has changed since;
            the dashboard totals use the stored value until you hit Refresh.
          </p>
        )}
      </div>
      <div>
        <div className="metric-label mb-2">Provenance</div>
        <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">Source</dt>
          <dd>{SOURCE_LABELS[r.source]}</dd>
          <dt className="text-muted">Session</dt>
          <dd className="tabular break-all">{r.sessionId}</dd>
          <dt className="text-muted">Project</dt>
          <dd className="break-all">{r.project ?? "—"}</dd>
          <dt className="text-muted">Event id</dt>
          <dd className="tabular break-all">{r.id}</dd>
          <dt className="text-muted">Timestamp</dt>
          <dd className="tabular">
            {new Date(r.ts).toISOString()} <span className="text-muted">({r.ts})</span>
          </dd>
        </dl>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "calm";
}) {
  return (
    <div className="card p-4">
      <div className="metric-label mb-2">{label}</div>
      <div className={`metric-value ${tone === "calm" ? "text-calm" : "text-text"}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted mt-2 tabular">{sub}</div>}
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  align = "left",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  dir?: "asc" | "desc";
  align?: "left" | "right";
}) {
  const content = (
    <>
      {children}
      {active && <span className="ml-1">{dir === "asc" ? "▲" : "▼"}</span>}
    </>
  );
  return (
    <th
      className={`font-normal py-2 px-3 whitespace-nowrap ${align === "right" ? "text-right" : ""} ${
        active ? "text-text" : ""
      }`}
    >
      {onClick ? (
        <button className="focus-ring hover:text-text transition-colors" onClick={onClick}>
          {content}
        </button>
      ) : (
        content
      )}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-1.5 px-3 text-right tabular text-muted ${className}`}>{children}</td>;
}
