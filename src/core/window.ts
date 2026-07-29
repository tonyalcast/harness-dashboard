export type WindowBlock = {
  start: number;
  end: number;
  tokens: number;
  /** Fraction of the 5h window elapsed at `now` (0–1), clamped. */
  elapsed: number;
  isCurrent: boolean;
};

export type WindowState = {
  label: "Reported" | "Estimated";
  start: number | null;
  end: number | null;
  tokens: number;
  burnPerMin: number;
  projectedDepletion: number | null;
  remainingMs: number | null;
  sourceNote: string;
};

const FIVE_H = 5 * 60 * 60 * 1000;

/**
 * Infer 5h blocks: a block opens at the first event after ≥5h of silence
 * and closes 5h later.
 */
export function inferWindows(
  timestamps: number[],
  tokenWeights: number[],
  now: number,
  windowMs = FIVE_H,
): WindowBlock[] {
  if (timestamps.length === 0) return [];
  const pairs = timestamps
    .map((ts, i) => ({ ts, tokens: tokenWeights[i] ?? 0 }))
    .sort((a, b) => a.ts - b.ts);

  const blocks: WindowBlock[] = [];
  let start = pairs[0]!.ts;
  let tokens = 0;

  for (const p of pairs) {
    if (p.ts - start >= windowMs && p.ts - (blocks.length ? start : start) >= windowMs) {
      // Gap from block start exceeded — close and open if silence from last event
    }
    if (p.ts >= start + windowMs) {
      blocks.push(makeBlock(start, start + windowMs, tokens, now, windowMs));
      start = p.ts;
      tokens = 0;
    }
    // Also: if silence since previous event ≥ windowMs, open fresh block at this event
    tokens += p.tokens;
  }
  // Rebuild with silence-aware boundaries (clearer second pass)
  return inferWindowsSilence(pairs, now, windowMs);
}

function inferWindowsSilence(
  pairs: Array<{ ts: number; tokens: number }>,
  now: number,
  windowMs: number,
): WindowBlock[] {
  if (pairs.length === 0) return [];
  const blocks: WindowBlock[] = [];
  let blockStart = pairs[0]!.ts;
  let blockTokens = 0;
  let lastTs = pairs[0]!.ts;

  for (const p of pairs) {
    if (p.ts - lastTs >= windowMs || p.ts >= blockStart + windowMs) {
      if (blockTokens > 0 || lastTs !== blockStart) {
        blocks.push(makeBlock(blockStart, blockStart + windowMs, blockTokens, now, windowMs));
      }
      blockStart = p.ts;
      blockTokens = 0;
    }
    blockTokens += p.tokens;
    lastTs = p.ts;
  }
  blocks.push(makeBlock(blockStart, blockStart + windowMs, blockTokens, now, windowMs));
  return blocks;
}

function makeBlock(
  start: number,
  end: number,
  tokens: number,
  now: number,
  windowMs: number,
): WindowBlock {
  const isCurrent = now >= start && now < end;
  const elapsed = Math.min(1, Math.max(0, (now - start) / windowMs));
  return { start, end, tokens, elapsed: isCurrent ? elapsed : now >= end ? 1 : 0, isCurrent };
}

export function currentWindowState(
  timestamps: number[],
  tokenWeights: number[],
  now: number,
  reported?: { start: number; end: number; tokens?: number } | null,
): WindowState {
  if (reported && reported.start && reported.end) {
    const tokens = reported.tokens ?? sumInRange(timestamps, tokenWeights, reported.start, now);
    const elapsedMin = Math.max(1 / 60, (now - reported.start) / 60_000);
    const burnPerMin = tokens / elapsedMin;
    const remainingMs = Math.max(0, reported.end - now);
    const remainingTokensPace = burnPerMin > 0 ? null : null;
    const projectedDepletion =
      burnPerMin > 0 ? reported.start + (tokens / burnPerMin) * 60_000 : null;
    void remainingTokensPace;
    return {
      label: "Reported",
      start: reported.start,
      end: reported.end,
      tokens,
      burnPerMin,
      projectedDepletion:
        projectedDepletion && projectedDepletion > now && projectedDepletion < reported.end
          ? projectedDepletion
          : burnPerMin > 0
            ? now + remainingMs
            : null,
      remainingMs,
      sourceNote: "Utilization reported by the harness.",
    };
  }

  const blocks = inferWindows(timestamps, tokenWeights, now);
  const current = [...blocks].reverse().find((b) => b.isCurrent) ?? blocks[blocks.length - 1];
  if (!current) {
    return {
      label: "Estimated",
      start: null,
      end: null,
      tokens: 0,
      burnPerMin: 0,
      projectedDepletion: null,
      remainingMs: null,
      sourceNote:
        "No local rate-limit state found. Blocks are inferred from ≥5h gaps between events.",
    };
  }

  const tokens = sumInRange(timestamps, tokenWeights, current.start, Math.min(now, current.end));
  const elapsedMin = Math.max(1 / 60, (Math.min(now, current.end) - current.start) / 60_000);
  const burnPerMin = tokens / elapsedMin;
  const remainingMs = Math.max(0, current.end - now);

  // Project when the current pace would exhaust a typical session budget is unknown;
  // instead project when cumulative burn at this rate would hit "end of window early"
  // relative to remaining time — show ETA as now + (implicit) if burn continues.
  // Spec: projected depletion of the window's remaining time at current burn —
  // we show the clock time when remaining token-time runs out if we treat the
  // tokens consumed so far as the "budget used" and extrapolate to window end fill.
  const projectedDepletion =
    burnPerMin > 0 && current.isCurrent
      ? current.start + ((tokens / burnPerMin) * 60_000)
      : null;

  return {
    label: "Estimated",
    start: current.start,
    end: current.end,
    tokens,
    burnPerMin,
    projectedDepletion:
      projectedDepletion && projectedDepletion > now && projectedDepletion < current.end
        ? projectedDepletion
        : null,
    remainingMs: current.isCurrent ? remainingMs : 0,
    sourceNote:
      "No local rate-limit state found. A block opens at the first event after ≥5h of silence and closes 5h later.",
  };
}

function sumInRange(
  timestamps: number[],
  tokenWeights: number[],
  from: number,
  to: number,
): number {
  let s = 0;
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i]!;
    if (ts >= from && ts <= to) s += tokenWeights[i] ?? 0;
  }
  return s;
}

/** Try to read a reported 5h window from Claude local files. Returns null when unavailable. */
export function readReportedClaudeWindow(_claudeHome?: string): {
  start: number;
  end: number;
  tokens?: number;
} | null {
  // See docs/LIMITS.md — no reliable local source found as of v1.
  return null;
}
