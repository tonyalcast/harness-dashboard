import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const envHelpers = require("../desktop/env.cjs");

describe("desktop env helpers", () => {
  test("rejects app bundle paths as repo roots", () => {
    expect(
      envHelpers.isValidRepoRoot(
        "/Applications/Harness Dashboard.app/Contents/Resources/app.asar",
      ),
    ).toBe(false);
  });

  test("discovers repo root by walking up from packaged resources path", () => {
    const repo = envHelpers.discoverRepoRoot(
      mkdtempSync(join(tmpdir(), "harness-data-")),
      join(import.meta.dir, "..", "dist", "desktop", "mac-arm64", "Harness Dashboard.app", "Contents", "Resources"),
    );
    expect(repo).toContain("harness-dashboard");
    expect(envHelpers.isValidRepoRoot(repo)).toBe(true);
    if (repo) rmSync(join(repo, ".harness-dashboard"), { recursive: true, force: true });
  });

  test("injectEnvFile loads cookie keys from a file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-env-"));
    writeFileSync(
      join(tmp, ".env"),
      "CURSOR_SESSION_COOKIE=cursor-test\nCLAUDE_ORG_ID=org-test\n",
    );
    const env = {};
    envHelpers.injectEnvFile(env, join(tmp, ".env"));
    expect(env.CURSOR_SESSION_COOKIE).toBe("cursor-test");
    expect(env.CLAUDE_ORG_ID).toBe("org-test");
    rmSync(tmp, { recursive: true, force: true });
  });
});
