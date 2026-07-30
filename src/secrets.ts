import { chmodSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { dataDir, ensureDataDir } from "./config";
import {
  SECRET_KEYS,
  type HarnessSecrets,
  type SecretKey,
  type SecretsSnapshot,
} from "./secrets-keys";

export { SECRET_KEYS, type HarnessSecrets, type SecretKey, type SecretsSnapshot } from "./secrets-keys";

export function secretsPath() {
  return join(dataDir(), "secrets.json");
}

export function loadSecrets(): HarnessSecrets {
  ensureDataDir();
  const path = secretsPath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as HarnessSecrets;
    return normalizeSecrets(raw);
  } catch {
    return {};
  }
}

export function saveSecrets(input: HarnessSecrets): HarnessSecrets {
  ensureDataDir();
  const cleaned = normalizeSecrets(input);
  const path = secretsPath();
  writeFileSync(path, JSON.stringify(cleaned, null, 2));
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort
  }
  return cleaned;
}

export function normalizeSecrets(input: HarnessSecrets): HarnessSecrets {
  const out: HarnessSecrets = {};
  for (const key of SECRET_KEYS) {
    const value = input[key]?.trim();
    if (value) out[key] = value;
  }
  return out;
}

/** Apply persisted secrets on top of whatever .env already loaded. */
export function applyStoredSecrets(stored = loadSecrets()) {
  for (const key of SECRET_KEYS) {
    const value = stored[key]?.trim();
    if (value) process.env[key] = value;
  }
}

export function secretsSnapshot(): SecretsSnapshot {
  const stored = loadSecrets();
  const active = Object.fromEntries(
    SECRET_KEYS.map((key) => [key, Boolean(process.env[key]?.trim())]),
  ) as Record<SecretKey, boolean>;
  const fromEnv = Object.fromEntries(
    SECRET_KEYS.map((key) => [key, active[key] && !stored[key]?.trim()]),
  ) as Record<SecretKey, boolean>;
  return { secrets: stored, active, fromEnv };
}
