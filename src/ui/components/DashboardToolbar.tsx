import { useEffect, useRef, useState } from "react";
import type { AppConfig, RefreshMode } from "../../adapters/types";
import {
  DASHBOARD_SECTION_KEYS,
  MINIMAL_DASHBOARD_SECTIONS,
  SECTION_LABELS,
  mergeDashboardSections,
  type DashboardSection,
  type DashboardSections,
} from "../../dashboard-sections";

type Props = {
  config: AppConfig;
  liveStatus: "live" | "reconnecting" | "offline" | "manual";
  onConfigChange: (next: AppConfig) => void | Promise<void>;
};

export function DashboardToolbar({ config, liveStatus, onConfigChange }: Props) {
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const sections = mergeDashboardSections(config.sections);
  const hiddenCount = DASHBOARD_SECTION_KEYS.filter((key) => !sections[key]).length;
  const isLive = config.refreshMode === "live";

  useEffect(() => {
    if (!sectionsOpen) return;
    function onDocClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setSectionsOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [sectionsOpen]);

  async function persist(patch: Partial<AppConfig>) {
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const next = (await res.json()) as AppConfig;
      await onConfigChange(next);
    } finally {
      setSaving(false);
    }
  }

  async function setRefreshMode(refreshMode: RefreshMode) {
    if (refreshMode === config.refreshMode) return;
    await persist({ refreshMode });
  }

  async function setSections(next: DashboardSections) {
    await persist({ sections: next });
  }

  const statusLabel =
    liveStatus === "manual"
      ? "manual"
      : liveStatus === "live"
        ? "live"
        : liveStatus === "reconnecting"
          ? "reconnecting"
          : "offline";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex items-center gap-2 rounded-md border border-border px-2 py-1">
        <span className="text-xs text-muted">Manual</span>
        <button
          type="button"
          role="switch"
          aria-checked={isLive}
          aria-label="Toggle live updates"
          disabled={saving}
          className={`focus-ring relative w-10 h-5 rounded-full transition-colors duration-150 ${
            isLive ? "bg-calm/70" : "bg-border"
          }`}
          onClick={() => void setRefreshMode(isLive ? "manual" : "live")}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-text transition-transform duration-150 ${
              isLive ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
        <span className="text-xs text-muted">Live</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted ml-1 pl-2 border-l border-border">
          <span
            className={`inline-block w-2 h-2 rounded-full live-dot ${
              liveStatus === "live"
                ? "bg-calm"
                : liveStatus === "reconnecting"
                  ? "bg-warn"
                  : "bg-muted"
            }`}
          />
          {statusLabel}
        </span>
      </div>

      <div className="relative" ref={panelRef}>
        <button
          type="button"
          className={`focus-ring text-xs px-2 py-1 rounded border transition-colors duration-150 ${
            sectionsOpen || hiddenCount > 0
              ? "border-accent/50 text-text"
              : "border-border text-muted hover:text-text"
          }`}
          onClick={() => setSectionsOpen((open) => !open)}
        >
          Sections{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
        </button>

        {sectionsOpen && (
          <div className="absolute right-0 z-40 mt-2 w-72 card p-3 shadow-lg border border-border">
            <p className="text-xs text-muted mb-2 leading-relaxed">
              Hidden sections are not loaded. Saved to{" "}
              <code className="text-text">~/.harness-dashboard/config.json</code>.
            </p>
            <button
              type="button"
              className="focus-ring text-xs text-accent hover:underline mb-3"
              disabled={saving}
              onClick={() => void setSections({ ...MINIMAL_DASHBOARD_SECTIONS })}
            >
              Minimal (subscriptions only)
            </button>
            <button
              type="button"
              className="focus-ring text-xs text-muted hover:text-text hover:underline mb-3 ml-3"
              disabled={saving}
              onClick={() =>
                void setSections({ ...mergeDashboardSections({}) })
              }
            >
              Show all
            </button>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {DASHBOARD_SECTION_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sections[key]}
                    disabled={saving}
                    onChange={(e) =>
                      void setSections({
                        ...sections,
                        [key]: e.target.checked,
                      })
                    }
                  />
                  {SECTION_LABELS[key as DashboardSection]}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
