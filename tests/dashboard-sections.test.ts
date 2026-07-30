import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DASHBOARD_SECTIONS,
  MINIMAL_DASHBOARD_SECTIONS,
  isSectionVisible,
  mergeDashboardSections,
  needsSummary,
} from "../src/dashboard-sections";
import { loadConfig, updateConfig } from "../src/config";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("dashboard sections", () => {
  test("minimal view only needs subscriptions", () => {
    expect(needsSummary(MINIMAL_DASHBOARD_SECTIONS)).toBe(false);
    expect(isSectionVisible(MINIMAL_DASHBOARD_SECTIONS, "subscriptions")).toBe(true);
    expect(isSectionVisible(MINIMAL_DASHBOARD_SECTIONS, "consumption")).toBe(false);
  });

  test("merge fills missing keys with defaults", () => {
    expect(
      mergeDashboardSections({ subscriptions: false }).subscriptions,
    ).toBe(false);
    expect(mergeDashboardSections({ subscriptions: false }).consumption).toBe(
      DEFAULT_DASHBOARD_SECTIONS.consumption,
    );
  });
});

describe("config refresh mode defaults", () => {
  let tmp = "";
  const savedDir = process.env.HARNESS_DASHBOARD_DATA_DIR;

  test("defaults to live refresh and all sections visible", () => {
    tmp = mkdtempSync(join(tmpdir(), "harness-config-"));
    process.env.HARNESS_DASHBOARD_DATA_DIR = tmp;

    const cfg = loadConfig();
    expect(cfg.refreshMode).toBe("live");
    expect(cfg.sections.subscriptions).toBe(true);
    expect(cfg.sections.consumption).toBe(true);

    const next = updateConfig({
      refreshMode: "live",
      sections: MINIMAL_DASHBOARD_SECTIONS,
    });
    expect(next.refreshMode).toBe("live");
    expect(next.sections).toEqual(MINIMAL_DASHBOARD_SECTIONS);
    expect(existsSync(join(tmp, "config.json"))).toBe(true);

    if (savedDir === undefined) delete process.env.HARNESS_DASHBOARD_DATA_DIR;
    else process.env.HARNESS_DASHBOARD_DATA_DIR = savedDir;
    rmSync(tmp, { recursive: true, force: true });
  });
});
