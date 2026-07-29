import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppConfig, FilterPreset, Source } from "../adapters/types";
import { useSSE } from "./hooks/useSSE";
import { BurnGauge } from "./components/BurnGauge";
import { MetricCard } from "./components/MetricCard";
import { WeeklyRing } from "./components/WeeklyRing";
import { SourceBadges } from "./components/SourceBadges";
import { TimeSeriesChart } from "./components/TimeSeriesChart";
import { ByHarnessChart } from "./components/ByHarnessChart";
import { ByModelChart } from "./components/ByModelChart";
import { BlockTimeline } from "./components/BlockTimeline";
import { Heatmap } from "./components/Heatmap";
import { TopSessions } from "./components/TopSessions";
import { WhatIf } from "./components/WhatIf";
import { SettingsPanel } from "./components/SettingsPanel";
import { formatTokens, formatUsd, formatDuration } from "./format";

type Summary = {
  tokens: { in: number; out: number; cacheWrite: number; cacheRead: number; total: number };
  costApi: number;
  costReported: number | null;
  cacheSavings: number;
  bySource: Array<{
    source: Source;
    tokens: { total: number };
    costApi: number;
    costReported: number | null;
    sessions: number;
  }>;
  byModel: Array<{ model: string; costApi: number; share: number; tokens: { total: number } }>;
  series: Array<{ t: number; tokens: number; costApi: number; source: Source }>;
  topSessions: Array<{
    sessionId: string;
    source: Source;
    project: string | null;
    model: string;
    tokens: { total: number };
    costApi: number;
    start: number;
    end: number;
  }>;
  heatmap: Array<{ day: string; tokens: number }>;
  blockTimeline: Array<{ start: number; end: number; tokens: number; isCurrent: boolean }>;
  weekly: {
    tokens: number;
    baseline: number;
    pct: number | null;
    estimated: true;
    calibrated: boolean;
  };
  budget: { monthlyBudgetUsd: number; spentApi: number; pct: number | null };
  unpricedModels: string[];
  whatIf: { currentCost: number; models: string[] };
  limitedData: boolean;
};

type WindowState = {
  label: "Reported" | "Estimated";
  start: number | null;
  end: number | null;
  tokens: number;
  burnPerMin: number;
  projectedDepletion: number | null;
  remainingMs: number | null;
  sourceNote: string;
};

type Health = {
  adapters: Array<{ source: Source; status: string; message?: string; skipped?: number }>;
};

const PRESETS: FilterPreset[] = ["today", "week", "month", "all", "custom"];
const ALL_SOURCES: Source[] = ["claude-code", "opencode", "cursor"];

export function App() {
  const [preset, setPreset] = useState<FilterPreset>("today");
  const [sources, setSources] = useState<Source[]>([]);
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [windowState, setWindow] = useState<WindowState | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const [banner, setBanner] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("preset", preset);
    if (sources.length) p.set("sources", sources.join(","));
    if (preset === "custom" && custom.from && custom.to) {
      p.set("from", String(new Date(custom.from).getTime()));
      p.set("to", String(new Date(custom.to).getTime()));
    }
    return p.toString();
  }, [preset, sources, custom]);

  const load = useCallback(async () => {
    const [s, w, h, c] = await Promise.all([
      fetch(`/api/summary?${query}`).then((r) => r.json()),
      fetch("/api/window").then((r) => r.json()),
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/config").then((r) => r.json()),
    ]);
    setSummary(s);
    setWindow(w);
    setHealth(h);
    setConfig(c);
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const { status: liveStatus } = useSSE("/api/events", () => {
    void load();
  });

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Budget alerts via Notification API with in-page fallback
  useEffect(() => {
    if (!summary?.budget.pct || !config) return;
    const thr = config.alerts.budgetPct;
    if (summary.budget.pct >= 100) {
      notify(`Monthly budget reached (${formatUsd(summary.budget.spentApi)})`, setBanner);
    } else if (summary.budget.pct >= thr) {
      notify(
        `Monthly budget at ${summary.budget.pct.toFixed(0)}% of ${formatUsd(config.monthlyBudgetUsd)}`,
        setBanner,
      );
    }
  }, [summary?.budget.pct, config]);

  const remainingLabel = useMemo(() => {
    if (!windowState?.end) return null;
    const ms = Math.max(0, windowState.end - tick);
    return formatDuration(ms);
  }, [windowState, tick]);

  async function calibrate() {
    await fetch("/api/calibrate", { method: "POST" });
    await load();
  }

  async function refresh() {
    await fetch("/api/refresh", { method: "POST" });
    await load();
  }

  function toggleSource(s: Source) {
    setSources((prev) => {
      if (prev.includes(s)) return prev.filter((x) => x !== s);
      return [...prev, s];
    });
  }

  const empty = !summary || summary.tokens.total === 0;

  return (
    <div className="min-h-screen px-4 py-5 md:px-8 md:py-6 max-w-[1400px] mx-auto">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">harness-dashboard</h1>
          <p className="text-sm text-muted mt-0.5">Fuel gauge for AI coding harnesses</p>
        </div>
        <div className="flex flex-col items-stretch md:items-end gap-2">
          <div className="flex flex-wrap items-center gap-2">
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
            <span className="inline-flex items-center gap-1.5 text-xs text-muted ml-1">
              <span
                className={`inline-block w-2 h-2 rounded-full live-dot ${
                  liveStatus === "live"
                    ? "bg-calm"
                    : liveStatus === "reconnecting"
                      ? "bg-warn"
                      : "bg-muted"
                }`}
              />
              {liveStatus === "live"
                ? "live"
                : liveStatus === "reconnecting"
                  ? "reconnecting"
                  : "offline"}
            </span>
          </div>
          {preset === "custom" && (
            <div className="flex gap-2 text-xs">
              <input
                type="datetime-local"
                className="focus-ring bg-surface border border-border rounded px-2 py-1"
                value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              />
              <input
                type="datetime-local"
                className="focus-ring bg-surface border border-border rounded px-2 py-1"
                value={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {ALL_SOURCES.map((s) => {
              const active = sources.length === 0 || sources.includes(s);
              return (
                <button
                  key={s}
                  className={`focus-ring text-xs px-2 py-1 rounded border transition-colors duration-150 ${
                    active
                      ? "border-accent/50 text-text"
                      : "border-border text-muted opacity-60"
                  }`}
                  onClick={() => toggleSource(s)}
                >
                  {s === "claude-code" ? "CC" : s === "opencode" ? "OC" : "Cursor"}
                </button>
              );
            })}
            <SourceBadges adapters={health?.adapters ?? []} />
            <button
              className="focus-ring text-xs text-muted hover:text-text px-2"
              onClick={() => void refresh()}
            >
              Refresh
            </button>
            <button
              className="focus-ring text-xs text-muted hover:text-text px-2"
              onClick={() => setSettingsOpen(true)}
            >
              Settings
            </button>
            <a
              className="focus-ring text-xs text-accent px-2"
              href={`/api/export?format=csv&${query}`}
            >
              CSV
            </a>
            <a
              className="focus-ring text-xs text-accent px-2"
              href={`/api/export?format=json&${query}`}
            >
              JSON
            </a>
          </div>
        </div>
      </header>

      {banner && (
        <div className="card mb-4 px-4 py-3 text-sm text-warn flex justify-between">
          <span>{banner}</span>
          <button className="focus-ring text-muted" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      )}

      <section className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="metric-label">5-hour window</div>
          {windowState && (
            <span
              className="text-xs px-2 py-0.5 rounded border border-border text-muted"
              title={windowState.sourceNote}
            >
              {windowState.label}
            </span>
          )}
        </div>
        <BurnGauge
          start={windowState?.start ?? null}
          end={windowState?.end ?? null}
          now={tick}
          tokens={windowState?.tokens ?? 0}
          burnPerMin={windowState?.burnPerMin ?? 0}
          projectedDepletion={windowState?.projectedDepletion ?? null}
        />
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            started{" "}
            <span className="tabular text-text">
              {windowState?.start ? fmtTime(windowState.start) : "—"}
            </span>
          </span>
          <span>
            resets{" "}
            <span className="tabular text-text">
              {windowState?.end ? fmtTime(windowState.end) : "—"}
            </span>
          </span>
          <span>
            <span className="tabular text-text">{remainingLabel ?? "—"}</span> left
          </span>
          <span>
            <span className="tabular text-text">
              {formatTokens(windowState?.tokens ?? 0)}
            </span>{" "}
            tokens
          </span>
          <span>
            <span className="tabular text-text">
              {formatTokens(Math.round(windowState?.burnPerMin ?? 0))}
            </span>
            /min
          </span>
          {windowState?.projectedDepletion && (
            <span>
              projected depletion{" "}
              <span className="tabular text-warn">
                {fmtTime(windowState.projectedDepletion)}
              </span>
            </span>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <MetricCard
          label="Tokens"
          value={formatTokens(summary?.tokens.total ?? 0)}
          hint={
            summary
              ? `${formatTokens(summary.tokens.in)} in · ${formatTokens(summary.tokens.out)} out · ${formatTokens(summary.tokens.cacheWrite)} cw · ${formatTokens(summary.tokens.cacheRead)} cr`
              : undefined
          }
        />
        <MetricCard
          label="API-equiv"
          value={formatUsd(summary?.costApi ?? 0)}
          tone="calm"
        />
        <MetricCard
          label="Reported"
          value={
            summary?.costReported == null ? "—" : formatUsd(summary.costReported)
          }
        />
        <MetricCard
          label="Cache saved"
          value={formatUsd(summary?.cacheSavings ?? 0)}
          tone="calm"
        />
      </section>

      {empty && (
        <div className="card p-6 mb-4 text-sm text-muted">
          No usage yet for this filter. Run a session in Claude Code or OpenCode, then hit
          Refresh. For Cursor, add <code className="text-text">CURSOR_SESSION_COOKIE</code> to{" "}
          <code className="text-text">.env</code>.
        </div>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <div className="card p-4 lg:col-span-1">
          <WeeklyRing
            pct={summary?.weekly.pct ?? null}
            calibrated={summary?.weekly.calibrated ?? false}
            tokens={summary?.weekly.tokens ?? 0}
            baseline={summary?.weekly.baseline ?? 0}
            onCalibrate={() => void calibrate()}
          />
        </div>
        <div className="card p-4 lg:col-span-2">
          <div className="metric-label mb-3">Consumption over time</div>
          <TimeSeriesChart series={summary?.series ?? []} />
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <div className="card p-4">
          <div className="metric-label mb-3">By harness</div>
          <ByHarnessChart rows={summary?.bySource ?? []} />
        </div>
        <div className="card p-4">
          <div className="metric-label mb-3">By model</div>
          <ByModelChart rows={summary?.byModel ?? []} />
        </div>
      </section>

      <section className="card p-4 mb-4">
        <div className="metric-label mb-3">5h block timeline (today)</div>
        <BlockTimeline blocks={summary?.blockTimeline ?? []} />
      </section>

      <section className="card p-4 mb-4">
        <div className="metric-label mb-3">Activity heatmap</div>
        <Heatmap days={summary?.heatmap ?? []} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
        <div className="card p-4">
          <div className="metric-label mb-3">Top expensive sessions</div>
          <TopSessions rows={summary?.topSessions ?? []} />
        </div>
        <div className="card p-4">
          <div className="metric-label mb-3">What-if model swap</div>
          <WhatIf
            models={summary?.whatIf.models ?? []}
            query={query}
            currentCost={summary?.costApi ?? 0}
          />
        </div>
      </section>

      {summary?.limitedData && (
        <p className="text-xs text-muted mb-2">
          Cursor rows are coarse monthly aggregates — treat them as limited data, not
          per-message precision.
        </p>
      )}
      {summary && summary.unpricedModels.length > 0 && (
        <p className="text-xs text-warn mb-2">
          Unpriced models (cost counted as $0): {summary.unpricedModels.join(", ")}
        </p>
      )}

      <footer className="text-xs text-muted border-t border-border pt-4 pb-8">
        API-equivalent cost is what this usage would cost at public list prices — not what
        you paid. Weekly % is estimated against your calibrated baseline. Binds to
        127.0.0.1:{/* port fixed */}4000. Read-only on harness data. Zero telemetry.
      </footer>

      {settingsOpen && config && (
        <SettingsPanel
          config={config}
          onClose={() => setSettingsOpen(false)}
          onSaved={async () => {
            setSettingsOpen(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function notify(msg: string, setBanner: (s: string) => void) {
  setBanner(msg);
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification("harness-dashboard", { body: msg });
  } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}
