import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type EnvMap = Record<string, string | undefined>;

export type Visibility = "private" | "public";

export interface AppConfig {
  accessKeyId: string;
  bucket: string;
  catalogPath: string;
  endpoint: string;
  envFilePath: string;
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
  "S3_STORAGE_CLI_ENDPOINT",
  "S3_STORAGE_CLI_REGION",
  "S3_STORAGE_CLI_ACCESS_KEY_ID",
  "S3_STORAGE_CLI_SECRET_ACCESS_KEY",
  "S3_STORAGE_CLI_BUCKET",
] as const;

const READY_ENV_KEYS = [...CORE_ENV_KEYS, "S3_STORAGE_CLI_PUBLIC_BASE_URL"] as const;

const OPTIONAL_SCOPED_ENV_KEYS = [
  "S3_STORAGE_CLI_SESSION_TOKEN",
  "S3_STORAGE_CLI_SHARE_TTL_SECONDS",
  "S3_STORAGE_CLI_VIRTUAL_HOSTED_STYLE",
  "S3_STORAGE_CLI_DB_PATH",
  "S3_STORAGE_CLI_ENV_PATH",
] as const;

const ALL_SCOPED_ENV_KEYS = [...READY_ENV_KEYS, ...OPTIONAL_SCOPED_ENV_KEYS] as const;

export function getReadyEnvKeys(): readonly string[] {
  return READY_ENV_KEYS;
}

export function getScopedEnvKeys(): readonly string[] {
  return ALL_SCOPED_ENV_KEYS;
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
  options: { homeDir?: string; catalogPath?: string; envFilePath?: string } = {},
): AppConfig {
  const missing = getMissingCoreEnvKeys(env);
  if (missing.length > 0) {
    throw new Error(`missing env ${missing.join(",")}`);
  }

  return {
    accessKeyId: env.S3_STORAGE_CLI_ACCESS_KEY_ID!.trim(),
    bucket: env.S3_STORAGE_CLI_BUCKET!.trim(),
    catalogPath: options.catalogPath ?? resolveCatalogPath(env, options.homeDir),
    endpoint: env.S3_STORAGE_CLI_ENDPOINT!.trim(),
    envFilePath: options.envFilePath ?? resolveConfigEnvPath(env, options.homeDir),
    publicBaseUrl: env.S3_STORAGE_CLI_PUBLIC_BASE_URL?.trim() || undefined,
    region: env.S3_STORAGE_CLI_REGION!.trim(),
    secretAccessKey: env.S3_STORAGE_CLI_SECRET_ACCESS_KEY!.trim(),
    sessionToken: env.S3_STORAGE_CLI_SESSION_TOKEN?.trim() || undefined,
    shareTtlSeconds: parsePositiveInteger(
      env.S3_STORAGE_CLI_SHARE_TTL_SECONDS,
      3600,
      "S3_STORAGE_CLI_SHARE_TTL_SECONDS",
    ),
    virtualHostedStyle: parseBoolean(env.S3_STORAGE_CLI_VIRTUAL_HOSTED_STYLE, false),
  };
}

export function resolveCatalogPath(env: EnvMap, customHomeDir?: string): string {
  const override = env.S3_STORAGE_CLI_DB_PATH?.trim();
  if (override) {
    return override;
  }

  return join(customHomeDir ?? homedir(), ".s3-storage-cli", "catalog.sqlite");
}

export function resolveConfigEnvPath(env: EnvMap, customHomeDir?: string): string {
  const override = env.S3_STORAGE_CLI_ENV_PATH?.trim();
  if (override) {
    return override;
  }

  return join(customHomeDir ?? homedir(), ".s3-storage-cli", "config.env");
}

export async function loadScopedEnv(
  processEnv: EnvMap,
  options: { envFilePath?: string; homeDir?: string } = {},
): Promise<EnvMap> {
  const envFilePath = options.envFilePath ?? resolveConfigEnvPath(processEnv, options.homeDir);
  const fileEnv = await readScopedEnvFile(envFilePath);

  return {
    ...fileEnv,
    ...processEnv,
  };
}

export async function readScopedEnvFile(envFilePath: string): Promise<EnvMap> {
  try {
    const content = await readFile(envFilePath, "utf8");
    return parseEnvFile(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

export async function writeScopedEnvFile(envFilePath: string, values: EnvMap): Promise<void> {
  const lines = [
    "# s3-storage-cli scoped configuration",
    ...ALL_SCOPED_ENV_KEYS.flatMap((key) => {
      const value = values[key];
      if (!value?.trim()) {
        return [];
      }

      return [`${key}=${JSON.stringify(value.trim())}`];
    }),
    "",
  ];

  await writeFile(envFilePath, lines.join("\n"), "utf8");
}

export function pickScopedEnv(env: EnvMap): EnvMap {
  const result: EnvMap = {};
  for (const key of ALL_SCOPED_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export function ensurePublicBaseUrl(config: AppConfig): string {
  if (!config.publicBaseUrl) {
    throw new Error("missing env S3_STORAGE_CLI_PUBLIC_BASE_URL");
  }

  return config.publicBaseUrl;
}

function parseEnvFile(content: string): EnvMap {
  const env: EnvMap = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    env[key] = parseEnvValue(rawValue);
  }

  return env;
}

function parseEnvValue(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }

  return value;
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
