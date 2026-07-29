import type { Source } from "../../adapters/types";

type Adapter = { source: Source; status: string; message?: string; skipped?: number };

export function SourceBadges({ adapters }: { adapters: Adapter[] }) {
  const order: Source[] = ["claude-code", "opencode", "cursor"];
  return (
    <div className="flex gap-1">
      {order.map((source) => {
        const a = adapters.find((x) => x.source === source);
        const status = a?.status ?? "unavailable";
        const color =
          status === "ok"
            ? "bg-calm"
            : status === "error"
              ? "bg-crit"
              : status === "disabled"
                ? "bg-muted"
                : "bg-warn";
        const label = source === "claude-code" ? "CC" : source === "opencode" ? "OC" : "Cu";
        return (
          <span
            key={source}
            title={a?.message ?? status}
            className="inline-flex items-center gap-1 text-[10px] text-muted px-1.5 py-0.5 rounded border border-border"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
            {label}
            {a?.skipped ? ` · ${a.skipped} skip` : ""}
          </span>
        );
      })}
    </div>
  );
}
