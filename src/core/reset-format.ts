/** Short relative reset countdowns, e.g. "5h", "3d 2h", "45m". */

export function formatResetShort(msFromNow: number): string {
  const ms = Math.max(0, Math.floor(msFromNow));
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 && hours < 6 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

export function formatResetAtShort(resetsAt: number, now = Date.now()): string {
  return formatResetShort(resetsAt - now);
}

export type ResetCandidate = {
  key: string;
  pct: number | null;
  resetsAt: number | null;
};

const PRIMARY_KEYS = [
  "five_hour",
  "five-hour",
  "5h",
  "continuous",
  "session",
  "included",
];

function keyRank(key: string): number {
  const lower = key.toLowerCase();
  const idx = PRIMARY_KEYS.findIndex((k) => lower.includes(k));
  return idx === -1 ? 100 : idx;
}

/**
 * Pick the "main" meter for a harness card: prefer 5h/session/continuous,
 * else the soonest reset. Returns nextResetAt + primaryPct.
 */
export function pickPrimaryMeter(
  candidates: ResetCandidate[],
  now = Date.now(),
): { nextResetAt: number | null; primaryPct: number | null } {
  const withReset = candidates.filter(
    (c) => c.resetsAt != null && Number.isFinite(c.resetsAt) && (c.resetsAt as number) > now - 60_000,
  );
  if (withReset.length === 0) {
    const withPct = candidates.find((c) => c.pct != null);
    return { nextResetAt: null, primaryPct: withPct?.pct ?? null };
  }

  withReset.sort((a, b) => {
    const rankDiff = keyRank(a.key) - keyRank(b.key);
    if (rankDiff !== 0) return rankDiff;
    return (a.resetsAt as number) - (b.resetsAt as number);
  });

  const best = withReset[0]!;
  return {
    nextResetAt: best.resetsAt,
    primaryPct: best.pct,
  };
}
