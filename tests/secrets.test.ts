import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("secrets storage", () => {
  let tmp = "";
  const savedDir = process.env.HARNESS_DASHBOARD_DATA_DIR;

  afterEach(() => {
    if (savedDir === undefined) delete process.env.HARNESS_DASHBOARD_DATA_DIR;
    else process.env.HARNESS_DASHBOARD_DATA_DIR = savedDir;
    for (const key of [
      "CURSOR_SESSION_COOKIE",
      "CLAUDE_SESSION_COOKIE",
      "CLAUDE_ORG_ID",
    ] as const) {
      delete process.env[key];
    }
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  test("persists and applies subscription cookies", async () => {
    tmp = mkdtempSync(join(tmpdir(), "harness-secrets-"));
    process.env.HARNESS_DASHBOARD_DATA_DIR = tmp;

    const { saveSecrets, loadSecrets, applyStoredSecrets, secretsPath } = await import(
      "../src/secrets"
    );

    saveSecrets({
      CURSOR_SESSION_COOKIE: "cursor-token",
      CLAUDE_ORG_ID: "org_123",
    });

    expect(existsSync(secretsPath())).toBe(true);
    expect(loadSecrets()).toEqual({
      CURSOR_SESSION_COOKIE: "cursor-token",
      CLAUDE_ORG_ID: "org_123",
    });

    delete process.env.CURSOR_SESSION_COOKIE;
    delete process.env.CLAUDE_ORG_ID;
    applyStoredSecrets();
    expect(process.env.CURSOR_SESSION_COOKIE).toBe("cursor-token");
    expect(process.env.CLAUDE_ORG_ID).toBe("org_123");
  });

  test("refreshHarnessCredentials reloads .env then stored secrets", async () => {
    tmp = mkdtempSync(join(tmpdir(), "harness-secrets-"));
    process.env.HARNESS_DASHBOARD_DATA_DIR = tmp;

    const { writeFileSync } = await import("fs");
    writeFileSync(
      join(tmp, ".env"),
      "CLAUDE_SESSION_COOKIE=from-dotenv\n",
    );

    const { saveSecrets } = await import("../src/secrets");
    const { refreshHarnessCredentials } = await import("../src/load-env");

    saveSecrets({ CLAUDE_SESSION_COOKIE: "from-settings" });
    refreshHarnessCredentials();
    expect(process.env.CLAUDE_SESSION_COOKIE).toBe("from-settings");
  });
});
