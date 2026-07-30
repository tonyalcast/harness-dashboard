import { useCallback, useEffect, useState } from "react";
import type { LimitBucket } from "../../adapters/claude-subscription";
import type { CursorSpendBucket } from "../../adapters/cursor-spending";
import type { OpenCodeGoBucket } from "../../adapters/opencode-subscription";
import { formatResetAtShort } from "../../core/reset-format";
import type { SourceSubscription } from "../../core/subscription";
import type { Source } from "../../adapters/types";
import { InfoTip, SectionLabel } from "./InfoTip";

const LABELS: Record<Source, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  cursor: "Cursor",
};

const ORDER: Source[] = ["claude-code", "opencode", "cursor"];

/** Turn "five_hour_limit.utilization" into "Five hour limit". */
function prettyKey(key: string): string {
  const leaf = key.split(".").filter(Boolean).pop() ?? key;
  const s = leaf
    .replace(/[_\-[\]]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtReset(ts: number): string {
  return formatResetAtShort(ts);
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function SubscriptionCards({
  autoLoad = true,
  refreshToken = 0,
  compact = false,
  hideHeader = false,
  onBusyChange,
}: {
  autoLoad?: boolean;
  refreshToken?: number;
  compact?: boolean;
  hideHeader?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [data, setData] = useState<SourceSubscription[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (force = false) => {
    setBusy(true);
    onBusyChange?.(true);
    try {
      const r = await fetch(`/api/subscription${force ? "?force=1" : ""}`).then((x) =>
        x.json(),
      );
      setData(r.sources ?? []);
    } catch {
      setData(null);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }, [onBusyChange]);

  useEffect(() => {
    if (autoLoad) void load();
  }, [autoLoad, load]);

  useEffect(() => {
    if (refreshToken > 0) void load(true);
  }, [refreshToken, load]);

  const bySource = new Map((data ?? []).map((s) => [s.source, s]));

  return (
    <section className={compact ? "" : "mb-4"}>
      {!hideHeader && (
        <div className="flex items-center justify-between gap-3 mb-2">
          <SectionLabel info="How much of each harness's subscription you have burned. Every vendor meters differently, so these are three separate readings — not one number split three ways. Measured, not estimated from token counts.">
            Subscription by harness
          </SectionLabel>
          <button
            className="focus-ring text-xs text-accent hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={() => void load(true)}
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      )}

      <div
        className={
          compact
            ? "flex flex-col gap-1.5"
            : "grid grid-cols-1 sm:grid-cols-3 gap-3"
        }
      >
        {data === null && !busy ? (
          <p className="text-[11px] text-muted py-1">
            {compact ? "Tap ↻" : "Press Refresh to load subscription meters."}
          </p>
        ) : (
          ORDER.map((source) => (
            <HarnessSubscription
              key={source}
              source={source}
              s={bySource.get(source)}
              compact={compact}
            />
          ))
        )}
      </div>
    </section>
  );
}

function HarnessSubscription({
  source,
  s,
  compact = false,
}: {
  source: Source;
  s?: SourceSubscription;
  compact?: boolean;
}) {
  const inactive = !s || s.status !== "ok";
  const cursorBuckets = source === "cursor" ? s?.cursorBuckets : undefined;
  const openCodeBuckets = source === "opencode" ? s?.openCodeBuckets : undefined;
  const resetLabel =
    s?.nextResetAt != null ? formatResetAtShort(s.nextResetAt) : null;
  const shortLabel =
    source === "claude-code" ? "Claude" : source === "opencode" ? "OpenCode" : "Cursor";

  if (compact) {
    const pct = s?.primaryPct;
    const tone =
      pct == null
        ? "var(--color-muted)"
        : pct >= 100
          ? "var(--color-crit)"
          : pct >= 80
            ? "var(--color-warn)"
            : "var(--color-calm)";
    const bar = pct == null ? 0 : Math.min(100, Math.max(0, pct));

    return (
      <div className={`compact-row ${inactive ? "opacity-60" : ""}`}>
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="text-[11px] font-medium truncate">{shortLabel}</span>
          <div className="flex items-center gap-1.5 tabular text-[11px] shrink-0">
            {s?.status === "ok" && pct != null ? (
              <span style={{ color: tone }}>{Math.round(pct)}%</span>
            ) : (
              <span className="text-muted">
                {!s ? "…" : s.status === "disabled" ? "—" : s.status}
              </span>
            )}
            {resetLabel && s?.status === "ok" && (
              <span className="text-muted">{resetLabel}</span>
            )}
          </div>
        </div>
        <div
          className="h-1 rounded-full overflow-hidden"
          style={{ background: "rgba(127, 143, 161, 0.25)" }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${bar}%`, background: tone }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`card p-4 ${inactive ? "opacity-70" : ""}`}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="metric-label">{LABELS[source]}</div>
        <div className="flex items-baseline gap-2 min-w-0">
          {resetLabel && s?.status === "ok" && (
            <span className="text-xs text-accent tabular whitespace-nowrap">
              Resets in {resetLabel}
            </span>
          )}
          {s?.plan && <span className="text-xs text-muted truncate">{s.plan}</span>}
          {!s?.plan && s?.status === "not-applicable" && (
            <span className="text-xs text-muted">no quota</span>
          )}
        </div>
      </div>

      {!s && <p className="text-sm text-muted">Loading…</p>}

      {s && s.status === "ok" && cursorBuckets && cursorBuckets.length > 0 && (
        <div className="flex flex-col gap-3">
          {cursorBuckets.map((b) => (
            <CursorBucket key={b.key} b={b} hardLimitUsd={s.hardLimitUsd} />
          ))}
        </div>
      )}

      {s && s.status === "ok" && openCodeBuckets && openCodeBuckets.length > 0 && (
        <div className="flex flex-col gap-3">
          {openCodeBuckets.map((b) => (
            <OpenCodeBucket key={b.key} b={b} />
          ))}
        </div>
      )}

      {s &&
        s.status === "ok" &&
        !(cursorBuckets && cursorBuckets.length > 0) &&
        !(openCodeBuckets && openCodeBuckets.length > 0) &&
        s.buckets.length === 0 && (
          <p className="text-xs text-muted">
            {s.message ??
              "Connected, but no limit buckets were recognised in the response."}
          </p>
        )}

      {s && s.status !== "ok" && (
        <p className={`text-xs ${s.status === "not-applicable" ? "text-muted" : "text-warn"}`}>
          {s.message}
        </p>
      )}

      {s &&
        s.status === "ok" &&
        !(cursorBuckets && cursorBuckets.length > 0) &&
        !(openCodeBuckets && openCodeBuckets.length > 0) &&
        s.buckets.length > 0 && (
          <div className="flex flex-col gap-3">
            {s.buckets.map((b) => (
              <Bucket key={b.key} b={b} />
            ))}
          </div>
        )}

      {s?.fetchedAt && (
        <p className="text-xs text-muted mt-3">
          Read {new Date(s.fetchedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

function OpenCodeBucket({ b }: { b: OpenCodeGoBucket }) {
  const pct = Math.min(100, Math.max(0, b.pct));
  const tone =
    pct >= 100
      ? "var(--color-crit)"
      : pct >= 80
        ? "var(--color-warn)"
        : "var(--color-calm)";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-sm">{b.label}</span>
        <span className="tabular text-sm" style={{ color: tone }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: "var(--color-border)" }}
        role="img"
        aria-label={`${b.label} ${Math.round(pct)} percent`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, background: tone }}
        />
      </div>
      <p className="mt-1 text-xs text-muted">
        Resets in {formatResetAtShort(Date.now() + b.resetInSec * 1000)}
      </p>
    </div>
  );
}

function CursorBucket({
  b,
  hardLimitUsd,
}: {
  b: CursorSpendBucket;
  hardLimitUsd?: number | null;
}) {
  const pct = b.pct == null ? null : Math.min(100, Math.max(0, b.pct));
  const tone =
    pct == null
      ? "var(--color-muted)"
      : pct >= 100
        ? "var(--color-crit)"
        : pct >= 80
          ? "var(--color-warn)"
          : "var(--color-calm)";

  const right =
    b.unit === "usd" && b.used != null && b.limit != null
      ? `${fmtUsd(b.used)} / ${fmtUsd(b.limit)}`
      : pct == null
        ? "—"
        : `${Math.round(pct)}% used`;

  return (
    <div>
      {b.subtitle && b.key === "onDemand" && (
        <div className="text-xs text-muted mb-1">{b.subtitle}</div>
      )}
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <span className="text-sm inline-flex items-center gap-1.5">
          {b.label}
          {b.hint && <InfoTip text={b.hint} align="left" />}
        </span>
        <span className="tabular text-sm" style={{ color: tone }}>
          {right}
        </span>
      </div>
      {b.subtitle && b.key !== "onDemand" && (
        <p className="text-xs text-muted mb-1">{b.subtitle}</p>
      )}
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: "var(--color-border)" }}
        role="img"
        aria-label={`${b.label} ${pct == null ? "unknown" : `${Math.round(pct)} percent`}`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct ?? 0}%`, background: tone }}
        />
      </div>
      {b.key === "onDemand" && hardLimitUsd != null && hardLimitUsd >= 0 && (
        <p className="mt-1 text-xs text-muted">
          Monthly limit · Fixed {hardLimitUsd}
        </p>
      )}
    </div>
  );
}

function Bucket({ b }: { b: LimitBucket }) {
  const pct = b.pct == null ? null : Math.min(100, Math.max(0, b.pct));
  const tone =
    pct == null
      ? "var(--color-muted)"
      : pct >= 100
        ? "var(--color-crit)"
        : pct >= 80
          ? "var(--color-warn)"
          : "var(--color-calm)";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-sm">{prettyKey(b.key)}</span>
        <span className="tabular text-sm" style={{ color: tone }}>
          {pct == null ? "—" : `${Math.round(pct)}%`}
        </span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: "var(--color-border)" }}
        role="img"
        aria-label={`${prettyKey(b.key)} ${
          pct == null ? "unknown" : `${Math.round(pct)} percent`
        }`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct ?? 0}%`, background: tone }}
        />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
        {b.used != null && b.limit != null && (
          <span className="tabular">
            {b.used.toLocaleString("en-US")} / {b.limit.toLocaleString("en-US")}
          </span>
        )}
        {b.resetsAt != null && <span>resets in {fmtReset(b.resetsAt)}</span>}
      </div>
    </div>
  );
}
