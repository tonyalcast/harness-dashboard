/** Browser-safe secret key definitions (no Node.js imports). */

export const SECRET_KEYS = [
  "CURSOR_SESSION_COOKIE",
  "CLAUDE_SESSION_COOKIE",
  "CLAUDE_ORG_ID",
  "OPENCODE_GO_WORKSPACE_ID",
  "OPENCODE_GO_AUTH_COOKIE",
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];
export type HarnessSecrets = Partial<Record<SecretKey, string>>;

export type SecretsSnapshot = {
  secrets: HarnessSecrets;
  active: Record<SecretKey, boolean>;
  fromEnv: Record<SecretKey, boolean>;
};
