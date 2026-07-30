import { describe, expect, test } from "bun:test";
import {
  formatResetShort,
  formatResetAtShort,
  pickPrimaryMeter,
} from "../src/core/reset-format";

describe("formatResetShort", () => {
  test("formats hours and days compactly", () => {
    expect(formatResetShort(5 * 3600 * 1000)).toBe("5h");
    expect(formatResetShort(45 * 60 * 1000)).toBe("45m");
    expect(formatResetShort(3 * 86_400 * 1000 + 2 * 3600 * 1000)).toBe("3d 2h");
    expect(formatResetShort(30_000)).toBe("<1m");
  });

  test("formatResetAtShort uses delta from now", () => {
    const now = 1_700_000_000_000;
    expect(formatResetAtShort(now + 2 * 3600 * 1000, now)).toBe("2h");
  });
});

describe("pickPrimaryMeter", () => {
  const now = 1_700_000_000_000;

  test("prefers five_hour / continuous over later monthly reset", () => {
    const picked = pickPrimaryMeter(
      [
        { key: "monthly", pct: 10, resetsAt: now + 20 * 86_400 * 1000 },
        { key: "five_hour", pct: 42, resetsAt: now + 5 * 3600 * 1000 },
      ],
      now,
    );
    expect(picked.primaryPct).toBe(42);
    expect(picked.nextResetAt).toBe(now + 5 * 3600 * 1000);
  });

  test("falls back to soonest reset when no primary key", () => {
    const picked = pickPrimaryMeter(
      [
        { key: "weekly", pct: 80, resetsAt: now + 7 * 86_400 * 1000 },
        { key: "other", pct: 55, resetsAt: now + 3600 * 1000 },
      ],
      now,
    );
    expect(picked.primaryPct).toBe(55);
    expect(picked.nextResetAt).toBe(now + 3600 * 1000);
  });
});
