/** Browser-safe dashboard section helpers (no Node.js imports). */

export type DashboardSection =
  | "subscriptions"
  | "consumption"
  | "byHarness"
  | "timeSeries"
  | "byModel"
  | "heatmap"
  | "topSessions"
  | "whatIf";

export type DashboardSections = Record<DashboardSection, boolean>;

export const DASHBOARD_SECTION_KEYS: DashboardSection[] = [
  "subscriptions",
  "consumption",
  "byHarness",
  "timeSeries",
  "byModel",
  "heatmap",
  "topSessions",
  "whatIf",
];

export const DEFAULT_DASHBOARD_SECTIONS: DashboardSections = {
  subscriptions: true,
  consumption: true,
  byHarness: true,
  timeSeries: true,
  byModel: true,
  heatmap: true,
  topSessions: true,
  whatIf: true,
};

export const MINIMAL_DASHBOARD_SECTIONS: DashboardSections = {
  subscriptions: true,
  consumption: false,
  byHarness: false,
  timeSeries: false,
  byModel: false,
  heatmap: false,
  topSessions: false,
  whatIf: false,
};

export const SECTION_LABELS: Record<DashboardSection, string> = {
  subscriptions: "Subscription by harness",
  consumption: "Consumption metrics",
  byHarness: "By harness",
  timeSeries: "Tokens over time",
  byModel: "By model",
  heatmap: "Activity heatmap",
  topSessions: "Top expensive sessions",
  whatIf: "What-if model swap",
};

export function mergeDashboardSections(
  patch?: Partial<DashboardSections>,
): DashboardSections {
  return { ...DEFAULT_DASHBOARD_SECTIONS, ...patch };
}

export function isSectionVisible(
  sections: DashboardSections | undefined,
  key: DashboardSection,
): boolean {
  return sections?.[key] !== false;
}

export function needsSummary(sections: DashboardSections | undefined): boolean {
  if (!sections) return true;
  return (
    sections.consumption ||
    sections.byHarness ||
    sections.timeSeries ||
    sections.byModel ||
    sections.heatmap ||
    sections.topSessions ||
    sections.whatIf
  );
}

export function needsHealth(sections: DashboardSections | undefined): boolean {
  return needsSummary(sections);
}
