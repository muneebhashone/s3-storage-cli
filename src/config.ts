import { homedir } from "node:os";
import { join } from "node:path";

export type EnvMap = Record<string, string | undefined>;

export type Visibility = "private" | "public";

export interface AppConfig {
  accessKeyId: string;
  bucket: string;
  catalogPath: string;
  endpoint: string;
  publicBaseUrl?: string;
  region: string;
  secretAccessKey: string;
  sessionToken?: string;
  shareTtlSeconds: number;
  virtualHostedStyle: boolean;
}

export interface EnvCheck {
  key: string;
  ok: boolean;
  requiredForReady: boolean;
  message?: string;
}

const CORE_ENV_KEYS = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
] as const;

const READY_ENV_KEYS = [...CORE_ENV_KEYS, "S3_PUBLIC_BASE_URL"] as const;

export function getReadyEnvKeys(): readonly string[] {
  return READY_ENV_KEYS;
}

export function inspectEnv(env: EnvMap): EnvCheck[] {
  return READY_ENV_KEYS.map((key) => {
    const value = env[key];
    return {
      key,
      ok: Boolean(value && value.trim()),
      requiredForReady: true,
      message: value && value.trim() ? undefined : `missing ${key}`,
    };
  });
}

export function getMissingCoreEnvKeys(env: EnvMap): string[] {
  return CORE_ENV_KEYS.filter((key) => !env[key]?.trim());
}

export function requireCoreConfig(
  env: EnvMap,
  options: { homeDir?: string; catalogPath?: string } = {},
): AppConfig {
  const missing = getMissingCoreEnvKeys(env);
  if (missing.length > 0) {
    throw new Error(`missing env ${missing.join(",")}`);
  }

  return {
    accessKeyId: env.S3_ACCESS_KEY_ID!.trim(),
    bucket: env.S3_BUCKET!.trim(),
    catalogPath: options.catalogPath ?? resolveCatalogPath(env, options.homeDir),
    endpoint: env.S3_ENDPOINT!.trim(),
    publicBaseUrl: env.S3_PUBLIC_BASE_URL?.trim() || undefined,
    region: env.S3_REGION!.trim(),
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!.trim(),
    sessionToken: env.S3_SESSION_TOKEN?.trim() || undefined,
    shareTtlSeconds: parsePositiveInteger(env.S3_SHARE_TTL_SECONDS, 3600, "S3_SHARE_TTL_SECONDS"),
    virtualHostedStyle: parseBoolean(env.S3_VIRTUAL_HOSTED_STYLE, false),
  };
}

export function resolveCatalogPath(env: EnvMap, customHomeDir?: string): string {
  const override = env.S3_CLI_DB_PATH?.trim();
  if (override) {
    return override;
  }

  return join(customHomeDir ?? homedir(), ".s3-storage-cli", "catalog.sqlite");
}

export function ensurePublicBaseUrl(config: AppConfig): string {
  if (!config.publicBaseUrl) {
    throw new Error("missing env S3_PUBLIC_BASE_URL");
  }

  return config.publicBaseUrl;
}

function parsePositiveInteger(raw: string | undefined, fallback: number, key: string): number {
  if (!raw?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid env ${key}`);
  }

  return parsed;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw?.trim()) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}
