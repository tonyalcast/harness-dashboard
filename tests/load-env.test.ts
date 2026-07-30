import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("loadHarnessEnv", () => {
  const saved: Record<string, string | undefined> = {};
  let tmp = "";

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const key of Object.keys(saved)) delete saved[key];
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  function stash(keys: string[]) {
    for (const key of keys) saved[key] = process.env[key];
  }

  test("loads cookies from HARNESS_DASHBOARD_ENV_FILE", async () => {
    tmp = mkdtempSync(join(tmpdir(), "harness-env-"));
    const envFile = join(tmp, ".env");
    writeFileSync(
      envFile,
      "CURSOR_SESSION_COOKIE=abc\nCLAUDE_SESSION_COOKIE=def\nCLAUDE_ORG_ID=org1\n",
    );
    stash([
      "HARNESS_DASHBOARD_ENV_FILE",
      "CURSOR_SESSION_COOKIE",
      "CLAUDE_SESSION_COOKIE",
      "CLAUDE_ORG_ID",
    ]);
    delete process.env.CURSOR_SESSION_COOKIE;
    delete process.env.CLAUDE_SESSION_COOKIE;
    delete process.env.CLAUDE_ORG_ID;
    process.env.HARNESS_DASHBOARD_ENV_FILE = envFile;

    const { loadHarnessEnv } = await import("../src/load-env");
    loadHarnessEnv();

    expect(process.env.CURSOR_SESSION_COOKIE).toBe("abc");
    expect(process.env.CLAUDE_SESSION_COOKIE).toBe("def");
    expect(process.env.CLAUDE_ORG_ID).toBe("org1");
  });
});
