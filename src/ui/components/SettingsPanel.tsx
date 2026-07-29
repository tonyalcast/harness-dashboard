import { useState } from "react";
import type { AppConfig, Plan } from "../../adapters/types";

type Props = {
  config: AppConfig;
  onClose: () => void;
  onSaved: () => void;
};

export function SettingsPanel({ config, onClose, onSaved }: Props) {
  const [form, setForm] = useState(config);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium">Settings</h2>
          <button className="focus-ring text-muted hover:text-text" onClick={onClose}>
            Close
          </button>
        </div>

        <label className="block text-xs text-muted mb-1">Plan</label>
        <select
          className="focus-ring w-full bg-bg border border-border rounded px-3 py-2 text-sm mb-3"
          value={form.plan}
          onChange={(e) => setForm({ ...form, plan: e.target.value as Plan })}
        >
          <option value="pro">Pro (1×)</option>
          <option value="max5x">Max 5×</option>
          <option value="max20x">Max 20×</option>
          <option value="custom">Custom</option>
        </select>

        <label className="block text-xs text-muted mb-1">Weekly baseline tokens</label>
        <input
          type="number"
          className="focus-ring w-full bg-bg border border-border rounded px-3 py-2 text-sm mb-3 tabular"
          value={form.weeklyBaselineTokens}
          onChange={(e) =>
            setForm({ ...form, weeklyBaselineTokens: Number(e.target.value) || 0 })
          }
        />

        <label className="block text-xs text-muted mb-1">Monthly budget (USD)</label>
        <input
          type="number"
          className="focus-ring w-full bg-bg border border-border rounded px-3 py-2 text-sm mb-3 tabular"
          value={form.monthlyBudgetUsd}
          onChange={(e) =>
            setForm({ ...form, monthlyBudgetUsd: Number(e.target.value) || 0 })
          }
        />

        <label className="block text-xs text-muted mb-1">Timezone</label>
        <input
          className="focus-ring w-full bg-bg border border-border rounded px-3 py-2 text-sm mb-3"
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        />

        <div className="text-xs text-muted mb-2">Adapters</div>
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
            {key}
          </label>
        ))}

        <p className="text-xs text-muted mt-2 mb-4">
          Cursor also requires <code>CURSOR_SESSION_COOKIE</code> in <code>.env</code>. The
          cookie is never stored in config or the database.
        </p>

        <button
          className="focus-ring w-full py-2 rounded bg-accent/20 text-accent border border-accent/40 hover:bg-accent/30 transition-colors duration-150 text-sm"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
