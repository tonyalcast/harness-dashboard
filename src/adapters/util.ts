import { createHash } from "crypto";
import type { Source } from "./types";

export function makeEventId(
  source: Source,
  sessionId: string,
  messageId: string,
  requestId?: string,
): string {
  const raw = `${source}|${sessionId}|${messageId}|${requestId ?? ""}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export function decodeClaudeProjectPath(encoded: string): string {
  if (!encoded.startsWith("-")) return encoded;
  // Encoded as absolute path with every `/` replaced by `-`
  return encoded.replace(/-/g, "/");
}

export function home(...parts: string[]): string {
  return [process.env.HOME ?? process.env.USERPROFILE ?? "", ...parts].join("/");
}
