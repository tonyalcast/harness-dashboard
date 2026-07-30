import type { Source } from "../adapters/types";

/** Characteristic color per harness — keep in sync with CSS --color-harness-*. */
export const HARNESS_COLOR: Record<Source, string> = {
  "claude-code": "#f0974e", // warm orange
  opencode: "#3ecf8e", // green
  cursor: "#6ea8fe", // soft blue
};

export const HARNESS_COLOR_CSS: Record<Source, string> = {
  "claude-code": "var(--color-harness-claude)",
  opencode: "var(--color-harness-opencode)",
  cursor: "var(--color-harness-cursor)",
};
