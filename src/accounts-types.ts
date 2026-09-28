/** Browser-safe account definitions (no Node.js imports). */

import type { Source } from "./adapters/types";

/**
 * An additional subscription account for a harness (e.g. a work Claude seat).
 * The primary account per harness still comes from .env / secrets.json.
 */
export type ExtraAccount = {
  id: string;
  source: Source;
  /** Custom display name, e.g. "Claude Work". */
  label: string;
  /** Plan value for the harness (see HarnessPlans); blank = whatever the vendor reports. */
  plan?: string;
  /** claude.ai sessionKey, WorkosCursorSessionToken, or opencode.ai auth cookie. */
  cookie: string;
  /** Claude only. */
  orgId?: string;
  /** OpenCode only. */
  workspaceId?: string;
};

export type AccountsConfig = {
  /** Custom display names for the primary account of each harness. */
  primaryLabels: Partial<Record<Source, string>>;
  extra: ExtraAccount[];
};

export const PRIMARY_ACCOUNT_ID = "primary";
