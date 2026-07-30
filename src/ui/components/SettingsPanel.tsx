import { useEffect, useState } from "react";
import type {
  AppConfig,
  ClaudePlan,
  CursorPlan,
  OpenCodePlan,
  Source,
} from "../../adapters/types";
import { SECRET_KEYS, type HarnessSecrets, type SecretKey } from "../../secrets-keys";
import { SectionLabel } from "./InfoTip";

type Props = {
  config: AppConfig;
  onClose: () => void;
  onSaved: () => void;
};

type SecretsSnapshot = {
  secrets: HarnessSecrets;
  active: Record<SecretKey, boolean>;
  fromEnv: Record<SecretKey, boolean>;
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

const SECRET_FIELDS: Array<{
  key: SecretKey;
  label: string;
  hint: string;
  multiline?: boolean;
}> = [
  {
    key: "CLAUDE_SESSION_COOKIE",
    label: "Claude session cookie",
    hint: "sessionKey from claude.ai cookies",
  },
  {
    key: "CLAUDE_ORG_ID",
    label: "Claude org ID",
    hint: "Organization id from claude.ai usage API",
  },
  {
    key: "OPENCODE_GO_WORKSPACE_ID",
    label: "OpenCode workspace ID",
    hint: "From opencode.ai/workspace/<id>/go",
  },
  {
    key: "OPENCODE_GO_AUTH_COOKIE",
    label: "OpenCode auth cookie",
    hint: "auth cookie from opencode.ai",
    multiline: true,
  },
  {
    key: "CURSOR_SESSION_COOKIE",
    label: "Cursor session cookie",
    hint: "WorkosCursorSessionToken from cursor.com",
    multiline: true,
  },
];

function emptySecrets(): Record<SecretKey, string> {
  return Object.fromEntries(SECRET_KEYS.map((key) => [key, ""])) as Record<SecretKey, string>;
}

export function SettingsPanel({ config, onClose, onSaved }: Props) {
  const [form, setForm] = useState<AppConfig>({
    ...config,
    plans: {
      "claude-code": config.plans?.["claude-code"] ?? config.plan ?? "max5x",
      opencode: config.plans?.opencode ?? "go",
      cursor: config.plans?.cursor ?? "pro",
    },
  });
  const [secrets, setSecrets] = useState<Record<SecretKey, string>>(emptySecrets);
  const [fromEnv, setFromEnv] = useState<Record<SecretKey, boolean>>(emptySecrets as Record<SecretKey, boolean>);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch("/api/secrets")
      .then((r) => r.json())
      .then((data: SecretsSnapshot) => {
        setSecrets({
          ...emptySecrets(),
          ...Object.fromEntries(
            SECRET_KEYS.map((key) => [key, data.secrets[key] ?? ""]),
          ),
        });
        setFromEnv(data.fromEnv ?? (emptySecrets() as Record<SecretKey, boolean>));
      });
  }, []);

  async function save() {
    setSaving(true);
    const payload: AppConfig = {
      ...form,
      plan: form.plans["claude-code"],
    };
    const secretsPayload = Object.fromEntries(
      SECRET_KEYS.map((key) => [key, secrets[key] ?? ""]),
    ) as HarnessSecrets;

    await Promise.all([
      fetch("/api/secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(secretsPayload),
      }),
      fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    ]);
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
            info="Session cookies for subscription meters. Saved locally in ~/.harness-dashboard/secrets.json (never sent anywhere except the vendor APIs). .env still works and takes precedence unless you save a value here."
          >
            Subscription cookies
          </SectionLabel>

          <div className="flex flex-col gap-3">
            {SECRET_FIELDS.map((field) => (
              <SecretField
                key={field.key}
                label={field.label}
                hint={field.hint}
                multiline={field.multiline}
                value={secrets[field.key]}
                fromEnv={fromEnv[field.key]}
                onChange={(value) =>
                  setSecrets((prev) => ({ ...prev, [field.key]: value }))
                }
              />
            ))}
          </div>

          <p className="text-xs text-muted mt-3 leading-relaxed">
            Values persist across restarts. Leave blank to fall back to{" "}
            <code className="text-text">.env</code> when present. See{" "}
            <code className="text-text">.env.example</code> for how to grab each cookie.
          </p>
        </section>

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
            info="Toggle which harness adapters feed local consumption."
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

function SecretField({
  label,
  hint,
  value,
  fromEnv,
  multiline,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  fromEnv: boolean;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  const shared =
    "focus-ring w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-xs";

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className="block text-xs text-muted">{label}</label>
        {fromEnv && !value.trim() && (
          <span className="text-[10px] text-calm uppercase tracking-wide">via .env</span>
        )}
      </div>
      {multiline ? (
        <textarea
          className={`${shared} min-h-[72px] resize-y`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={hint}
          autoComplete="off"
          spellCheck={false}
        />
      ) : (
        <input
          type="password"
          className={shared}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={hint}
          autoComplete="off"
          spellCheck={false}
        />
      )}
      <p className="text-[11px] text-muted mt-1">{hint}</p>
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
