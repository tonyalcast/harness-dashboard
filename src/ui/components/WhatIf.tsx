import { useEffect, useState } from "react";
import { formatUsd } from "../format";

type Props = {
  models: string[];
  query: string;
  currentCost: number;
};

export function WhatIf({ models, query, currentCost }: Props) {
  const [model, setModel] = useState(models[0] ?? "claude-sonnet-4-20250514");
  const [result, setResult] = useState<{ current: number; hypothetical: number; delta: number } | null>(
    null,
  );

  useEffect(() => {
    if (models.length && !models.includes(model)) setModel(models[0]!);
  }, [models, model]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/whatif?${query}&model=${encodeURIComponent(model)}`);
      const data = await res.json();
      if (!cancelled) setResult(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [model, query]);

  if (models.length === 0) {
    return <p className="text-sm text-muted py-4">Need usage data to run a what-if.</p>;
  }

  const savings = result?.delta ?? 0;

  return (
    <div>
      <label className="text-xs text-muted block mb-2">Price these tokens as</label>
      <select
        className="focus-ring w-full bg-bg border border-border rounded px-3 py-2 text-sm mb-3"
        value={model}
        onChange={(e) => setModel(e.target.value)}
      >
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        {!models.includes("claude-sonnet-4-20250514") && (
          <option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514</option>
        )}
        {!models.includes("claude-opus-4-20250514") && (
          <option value="claude-opus-4-20250514">claude-opus-4-20250514</option>
        )}
      </select>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <div className="text-xs text-muted">Current</div>
          <div className="tabular">{formatUsd(result?.current ?? currentCost)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">As {model.split("/").pop()}</div>
          <div className="tabular">{formatUsd(result?.hypothetical ?? 0)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Delta</div>
          <div className={`tabular ${savings >= 0 ? "text-calm" : "text-warn"}`}>
            {savings >= 0 ? "−" : "+"}
            {formatUsd(Math.abs(savings))}
          </div>
        </div>
      </div>
    </div>
  );
}
