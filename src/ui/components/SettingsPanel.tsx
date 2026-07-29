import { useState } from "react";
import type {
  AppConfig,
  ClaudePlan,
  CursorPlan,
  OpenCodePlan,
  Source,
} from "../../adapters/types";
import { SectionLabel } from "./InfoTip";

type Props = {
  config: AppConfig;
  onClose: () => void;
  onSaved: () => void;
};

const HARNESS_LABEL: Record<Source, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  cursor: "Cursor",
};

const CLAUDE_PLANS: { value: ClaudePlan; label: string }[] = [
  { value: "pro", label: "Pro (1×)" },
  { value: "max5x", label: "Max 5×" },
  { value: "max20x", label: "Max 20×" },
  { value: "custom", label: "Custom" },
];

const OPENCODE_PLANS: { value: OpenCodePlan; label: string }[] = [
  { value: "go", label: "Go" },
  { value: "api", label: "API keys only" },
  { value: "custom", label: "Custom" },
];

const CURSOR_PLANS: { value: CursorPlan; label: string }[] = [
  { value: "hobby", label: "Hobby" },
  { value: "pro", label: "Pro" },
  { value: "pro-plus", label: "Pro Plus" },
  { value: "ultra", label: "Ultra" },
  { value: "business", label: "Business" },
  { value: "custom", label: "Custom" },
];

export function SettingsPanel({ config, onClose, onSaved }: Props) {
  const [form, setForm] = useState<AppConfig>({
    ...config,
    plans: {
      "claude-code": config.plans?.["claude-code"] ?? config.plan ?? "max5x",
      opencode: config.plans?.opencode ?? "go",
      cursor: config.plans?.cursor ?? "pro",
    },
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const payload: AppConfig = {
      ...form,
      plan: form.plans["claude-code"],
    };
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium">Settings</h2>
          <button type="button" className="focus-ring text-muted hover:text-text" onClick={onClose}>
            Close
          </button>
        </div>

        <section className="mb-5">
          <SectionLabel
            className="mb-3"
            info="Which subscription you are on for each harness. Shown on Subscription by harness. Each vendor meters differently — these are three separate plans, not one."
          >
            Plans by harness
          </SectionLabel>

          <div className="flex flex-col gap-3">
            <PlanSelect
              label={HARNESS_LABEL["claude-code"]}
              value={form.plans["claude-code"]}
              options={CLAUDE_PLANS}
              onChange={(plan) =>
                setForm({
                  ...form,
                  plan,
                  plans: { ...form.plans, "claude-code": plan },
                })
              }
            />
            <PlanSelect
              label={HARNESS_LABEL.opencode}
              value={form.plans.opencode}
              options={OPENCODE_PLANS}
              onChange={(plan) =>
                setForm({
                  ...form,
                  plans: { ...form.plans, opencode: plan },
                })
              }
            />
            <PlanSelect
              label={HARNESS_LABEL.cursor}
              value={form.plans.cursor}
              options={CURSOR_PLANS}
              onChange={(plan) =>
                setForm({
                  ...form,
                  plans: { ...form.plans, cursor: plan },
                })
              }
            />
          </div>
        </section>

        <section className="mb-5">
          <SectionLabel
            className="mb-3"
            info="Local preferences for budgeting and day boundaries. Does not change vendor accounts."
          >
            Preferences
          </SectionLabel>

          <label className="block text-xs text-muted mb-1">Monthly budget (USD)</label>
          <input
            type="number"
            min={0}
            className="focus-ring w-full bg-bg border border-border rounded px-3 py-2 text-sm mb-3 tabular"
            value={form.monthlyBudgetUsd}
            onChange={(e) =>
              setForm({ ...form, monthlyBudgetUsd: Number(e.target.value) || 0 })
            }
          />

          <label className="block text-xs text-muted mb-1">Budget alert at (%)</label>
          <input
            type="number"
            min={1}
            max={100}
            className="focus-ring w-full bg-bg border border-border rounded px-3 py-2 text-sm mb-3 tabular"
            value={form.alerts.budgetPct}
            onChange={(e) =>
              setForm({
                ...form,
                alerts: {
                  ...form.alerts,
                  budgetPct: Math.min(100, Math.max(1, Number(e.target.value) || 80)),
                },
              })
            }
          />

          <label className="block text-xs text-muted mb-1">Timezone</label>
          <input
            className="focus-ring w-full bg-bg border border-border rounded px-3 py-2 text-sm"
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            placeholder="America/Mexico_City"
          />
        </section>

        <section className="mb-5">
          <SectionLabel
            className="mb-3"
            info="Toggle which harness adapters feed local consumption. Subscription cookies still live in .env — never in this panel."
          >
            Adapters
          </SectionLabel>

          {(["claude-code", "opencode", "cursor"] as const).map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm mb-2">
              <input
                type="checkbox"
                checked={form.adapters[key].enabled}
                onChange={(e) =>
                  setForm({
                    ...form,
                    adapters: {
                      ...form.adapters,
                      [key]: { ...form.adapters[key], enabled: e.target.checked },
                    },
                  })
                }
              />
              {HARNESS_LABEL[key]}
            </label>
          ))}

          <p className="text-xs text-muted mt-3 leading-relaxed">
            Optional subscription cookies go in <code className="text-text">.env</code> only
            (<code className="text-text">CLAUDE_*</code>,{" "}
            <code className="text-text">OPENCODE_GO_*</code>,{" "}
            <code className="text-text">CURSOR_SESSION_COOKIE</code>). They are never stored
            in config or SQLite.
          </p>
        </section>

        <div className="flex gap-2">
          <button
            type="button"
            className="focus-ring flex-1 py-2 rounded border border-border text-muted hover:text-text text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="focus-ring flex-1 py-2 rounded bg-accent/20 text-accent border border-accent/40 hover:bg-accent/30 transition-colors duration-150 text-sm"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1">{label}</label>
      <select
        className="focus-ring w-full bg-bg border border-border rounded px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
