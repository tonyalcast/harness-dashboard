import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ENV_KEYS = [
  "CLAUDE_SESSION_COOKIE",
  "CLAUDE_ORG_ID",
  "CURSOR_SESSION_COOKIE",
  "OPENCODE_GO_WORKSPACE_ID",
  "OPENCODE_GO_AUTH_COOKIE",
] as const;

describe("extra subscription accounts", () => {
  let tmp = "";
  const savedDir = process.env.HARNESS_DASHBOARD_DATA_DIR;
  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "harness-accounts-"));
    process.env.HARNESS_DASHBOARD_DATA_DIR = tmp;
    // Keep the report offline: no primary account is configured.
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    if (savedDir === undefined) delete process.env.HARNESS_DASHBOARD_DATA_DIR;
    else process.env.HARNESS_DASHBOARD_DATA_DIR = savedDir;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  test("normalizes labels, ids and per-harness credential fields", async () => {
    const { saveAccounts, loadAccounts, accountsPath } = await import("../src/accounts");
    const saved = saveAccounts({
      primaryLabels: { "claude-code": "  Claude  ", cursor: "   ", bogus: "x" },
      extra: [
        { id: "a", source: "claude-code", label: " Claude Work ", cookie: " sk ", orgId: " org " },
        { id: "a", source: "cursor", label: "", cookie: "tok", orgId: "ignored" },
        { source: "nope", label: "dropped" },
      ],
    });

    expect(saved.primaryLabels).toEqual({ "claude-code": "Claude" });
    expect(saved.extra).toHaveLength(2);
    expect(saved.extra[0]).toEqual({
      id: "a",
      source: "claude-code",
      label: "Claude Work",
      cookie: "sk",
      orgId: "org",
    });
    // Duplicate id is replaced; blank label gets a numbered default.
    expect(saved.extra[1]!.id).not.toBe("a");
    expect(saved.extra[1]!.label).toBe("Cursor 2");
    expect("orgId" in saved.extra[1]!).toBe(false);

    expect(loadAccounts()).toEqual(saved);
    expect(statSync(accountsPath()).mode & 0o777).toBe(0o600);
  });

  test("report lists extra accounts after each harness's primary", async () => {
    const { saveAccounts } = await import("../src/accounts");
    saveAccounts({
      primaryLabels: { "claude-code": "Claude Personal" },
      extra: [
        { id: "cur2", source: "cursor", label: "Cursor Team", cookie: "" },
        { id: "cl2", source: "claude-code", label: "Claude Work", cookie: "", plan: "max20x" },
      ],
    });

    const { buildSubscriptionReport } = await import("../src/core/subscription");
    const { sources } = await buildSubscriptionReport(true);

    expect(sources.map((s) => [s.source, s.accountId, s.label])).toEqual([
      ["claude-code", "primary", "Claude Personal"],
      ["claude-code", "cl2", "Claude Work"],
      ["opencode", "primary", undefined],
      ["cursor", "primary", undefined],
      ["cursor", "cur2", "Cursor Team"],
    ]);

    const work = sources.find((s) => s.accountId === "cl2")!;
    expect(work.status).toBe("disabled");
    expect(work.message).toContain("Settings");
    expect(work.plan).toBe("Max 20×");
  });
});
