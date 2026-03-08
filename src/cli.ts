import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Catalog } from "./catalog";
import {
  ensurePublicBaseUrl,
  getReadyEnvKeys,
  inspectEnv,
  loadScopedEnv,
  pickScopedEnv,
  requireCoreConfig,
  resolveCatalogPath,
  resolveConfigEnvPath,
  type AppConfig,
  type EnvMap,
  type Visibility,
  writeScopedEnvFile,
} from "./config";
import { resolveUploadTargets } from "./files";
import { createDefaultIo, emitEnvCheck, emitError, emitJson, formatTimestamp, type CliIo } from "./output";
import { BunStorageClient, type StorageClient } from "./storage";

interface ParsedArgs {
  command: string | null;
  flags: Record<string, string | boolean>;
  positionals: string[];
}

interface PromptLike {
  ask: (question: string, defaultValue?: string) => Promise<string>;
  close?: () => void | Promise<void>;
}

interface RunCliOptions {
  catalogPath?: string;
  cwd?: string;
  env?: EnvMap;
  envFilePath?: string;
  homeDir?: string;
  io?: CliIo;
  now?: () => Date;
  prompter?: PromptLike;
  storageFactory?: (config: AppConfig) => StorageClient;
}

interface StatusCheckResult {
  message?: string;
  name: string;
  ok: boolean;
}

const SETUP_QUESTIONS: Array<{ key: string; label: string }> = [
  { key: "S3_STORAGE_CLI_ENDPOINT", label: "S3 endpoint URL" },
  { key: "S3_STORAGE_CLI_REGION", label: "S3 region" },
  { key: "S3_STORAGE_CLI_ACCESS_KEY_ID", label: "Access key ID" },
  { key: "S3_STORAGE_CLI_SECRET_ACCESS_KEY", label: "Secret access key" },
  { key: "S3_STORAGE_CLI_BUCKET", label: "Bucket name" },
  { key: "S3_STORAGE_CLI_PUBLIC_BASE_URL", label: "Public base URL" },
] as const;

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const io = options.io ?? createDefaultIo();
  const processEnv = options.env ?? process.env;
  const env = await loadScopedEnv(processEnv, {
    envFilePath: options.envFilePath,
    homeDir: options.homeDir,
  });
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? (() => new Date());
  const storageFactory = options.storageFactory ?? ((config: AppConfig) => new BunStorageClient(config));

  try {
    const parsed = parseArgs(argv);
    if (!parsed.command || parsed.flags.help) {
      printHelp(io);
      return 0;
    }

    switch (parsed.command) {
      case "setup":
        return await runSetup(parsed, {
          env,
          envFilePath: options.envFilePath,
          homeDir: options.homeDir,
          io,
          prompter: options.prompter,
        });
      case "list":
      case "ls":
        return await runList(parsed, {
          catalogPath: options.catalogPath,
          env,
          envFilePath: options.envFilePath,
          homeDir: options.homeDir,
          io,
        });
      case "upload":
      case "up":
        return await runUpload(parsed, {
          catalogPath: options.catalogPath,
          cwd,
          env,
          envFilePath: options.envFilePath,
          homeDir: options.homeDir,
          io,
          now,
          storageFactory,
        });
      case "delete":
      case "rm":
        return await runDelete(parsed, {
          catalogPath: options.catalogPath,
          env,
          envFilePath: options.envFilePath,
          homeDir: options.homeDir,
          io,
          now,
          storageFactory,
        });
      case "share":
      case "sh":
        return await runShare(parsed, {
          catalogPath: options.catalogPath,
          env,
          envFilePath: options.envFilePath,
          homeDir: options.homeDir,
          io,
          storageFactory,
        });
      case "status":
      case "st":
        return await runStatus(parsed, {
          catalogPath: options.catalogPath,
          env,
          envFilePath: options.envFilePath,
          homeDir: options.homeDir,
          io,
          storageFactory,
        });
      default:
        throw new Error(`unknown command ${parsed.command}`);
    }
  } catch (error) {
    emitError(io, "cli", getErrorMessage(error));
    return 1;
  }
}

async function runSetup(
  parsed: ParsedArgs,
  options: {
    env: EnvMap;
    envFilePath?: string;
    homeDir?: string;
    io: CliIo;
    prompter?: PromptLike;
  },
): Promise<number> {
  if (parsed.positionals.length > 0) {
    throw new Error("setup does not accept positional arguments");
  }

  const envFilePath = options.envFilePath ?? resolveConfigEnvPath(options.env, options.homeDir);
  await mkdir(dirname(envFilePath), { recursive: true });

  const prompter = options.prompter ?? createPrompter();
  const nextEnv = {
    ...pickScopedEnv(options.env),
  };

  try {
    for (const question of SETUP_QUESTIONS) {
      const answer = await promptRequiredValue(prompter, question.label, nextEnv[question.key]);
      nextEnv[question.key] = answer;
    }
  } finally {
    await prompter.close?.();
  }

  await writeScopedEnvFile(envFilePath, nextEnv);

  if (parsed.flags.json) {
    emitJson(options.io, {
      envFilePath,
      savedKeys: SETUP_QUESTIONS.map((question) => question.key),
    });
    return 0;
  }

  options.io.stdout(`saved\t${envFilePath}`);
  return 0;
}

async function runList(
  parsed: ParsedArgs,
  options: { catalogPath?: string; env: EnvMap; envFilePath?: string; homeDir?: string; io: CliIo },
): Promise<number> {
  if (parsed.positionals.length > 1) {
    throw new Error("list accepts at most one prefix");
  }

  const config = requireCoreConfig(options.env, {
    catalogPath: options.catalogPath,
    envFilePath: options.envFilePath,
    homeDir: options.homeDir,
  });

  const catalog = new Catalog(config.catalogPath);
  try {
    const objects = catalog.listObjects(config.bucket, parsed.positionals[0]);
    if (parsed.flags.json) {
      emitJson(options.io, { bucket: config.bucket, objects });
      return 0;
    }

    for (const object of objects) {
      options.io.stdout(
        `${object.key}\t${object.visibility}\t${object.size}\t${formatTimestamp(object.uploadedAt)}`,
      );
    }
    return 0;
  } finally {
    catalog.close();
  }
}

async function runUpload(
  parsed: ParsedArgs,
  options: {
    catalogPath?: string;
    cwd: string;
    env: EnvMap;
    envFilePath?: string;
    homeDir?: string;
    io: CliIo;
    now: () => Date;
    storageFactory: (config: AppConfig) => StorageClient;
  },
): Promise<number> {
  const visibility = resolveVisibility(parsed.flags);
  const prefix = readOptionalStringFlag(parsed.flags, "prefix");
  const config = requireCoreConfig(options.env, {
    catalogPath: options.catalogPath,
    envFilePath: options.envFilePath,
    homeDir: options.homeDir,
  });

  if (visibility === "public") {
    ensurePublicBaseUrl(config);
  }

  const uploadTargets = await resolveUploadTargets(parsed.positionals, {
    cwd: options.cwd,
    prefix,
  });

  await mkdir(dirname(config.catalogPath), { recursive: true });
  const storage = options.storageFactory(config);
  const catalog = new Catalog(config.catalogPath);
  const uploaded: Array<{ key: string; size: number; visibility: Visibility }> = [];

  try {
    for (const target of uploadTargets) {
      const remoteMeta = await storage.uploadFile(target.absolutePath, target.key, visibility);
      const uploadedAt = options.now().toISOString();
      catalog.upsertObject({
        bucket: config.bucket,
        contentType: remoteMeta.contentType,
        etag: remoteMeta.etag,
        key: target.key,
        size: remoteMeta.size,
        sourcePath: target.sourcePath,
        uploadedAt,
        visibility,
      });
      uploaded.push({
        key: target.key,
        size: remoteMeta.size,
        visibility,
      });
    }

    if (parsed.flags.json) {
      emitJson(options.io, { bucket: config.bucket, uploaded });
      return 0;
    }

    for (const item of uploaded) {
      options.io.stdout(`uploaded\t${item.key}\t${item.visibility}\t${item.size}`);
    }
    return 0;
  } finally {
    catalog.close();
  }
}

async function runDelete(
  parsed: ParsedArgs,
  options: {
    catalogPath?: string;
    env: EnvMap;
    envFilePath?: string;
    homeDir?: string;
    io: CliIo;
    now: () => Date;
    storageFactory: (config: AppConfig) => StorageClient;
  },
): Promise<number> {
  if (parsed.positionals.length === 0) {
    throw new Error("delete requires at least one key");
  }

  const config = requireCoreConfig(options.env, {
    catalogPath: options.catalogPath,
    envFilePath: options.envFilePath,
    homeDir: options.homeDir,
  });
  const storage = options.storageFactory(config);
  const catalog = new Catalog(config.catalogPath);
  const deleted: string[] = [];
  const errors: Array<{ key: string; message: string }> = [];

  try {
    for (const key of parsed.positionals) {
      const tracked = catalog.getObject(config.bucket, key);
      if (!tracked) {
        const message = `untracked key ${key}`;
        errors.push({ key, message });
        if (!parsed.flags.json) {
          emitError(options.io, "delete", message);
        }
        continue;
      }

      try {
        await storage.deleteObject(key);
        catalog.softDeleteObject(config.bucket, key, options.now().toISOString());
        deleted.push(key);
      } catch (error) {
        const message = `${key} ${getErrorMessage(error)}`;
        errors.push({ key, message });
        if (!parsed.flags.json) {
          emitError(options.io, "delete", message);
        }
      }
    }

    if (parsed.flags.json) {
      emitJson(options.io, { bucket: config.bucket, deleted, errors });
    } else {
      for (const key of deleted) {
        options.io.stdout(`deleted\t${key}`);
      }
    }

    return errors.length === 0 ? 0 : 1;
  } finally {
    catalog.close();
  }
}

async function runShare(
  parsed: ParsedArgs,
  options: {
    catalogPath?: string;
    env: EnvMap;
    envFilePath?: string;
    homeDir?: string;
    io: CliIo;
    storageFactory: (config: AppConfig) => StorageClient;
  },
): Promise<number> {
  if (parsed.positionals.length !== 1) {
    throw new Error("share requires exactly one key");
  }

  const config = requireCoreConfig(options.env, {
    catalogPath: options.catalogPath,
    envFilePath: options.envFilePath,
    homeDir: options.homeDir,
  });
  const catalog = new Catalog(config.catalogPath);
  try {
    const key = parsed.positionals[0]!;
    const tracked = catalog.getObject(config.bucket, key);
    if (!tracked) {
      throw new Error(`untracked key ${key}`);
    }

    if (tracked.visibility === "public") {
      ensurePublicBaseUrl(config);
    }

    const expiresIn = readOptionalPositiveIntegerFlag(parsed.flags, "expires") ?? config.shareTtlSeconds;
    const storage = options.storageFactory(config);
    const url = await storage.getShareUrl(key, tracked.visibility, expiresIn);

    if (parsed.flags.json) {
      emitJson(options.io, {
        expiresIn: tracked.visibility === "private" ? expiresIn : null,
        key,
        url,
        visibility: tracked.visibility,
      });
      return 0;
    }

    options.io.stdout(url);
    return 0;
  } finally {
    catalog.close();
  }
}

async function runStatus(
  parsed: ParsedArgs,
  options: {
    catalogPath?: string;
    env: EnvMap;
    envFilePath?: string;
    homeDir?: string;
    io: CliIo;
    storageFactory: (config: AppConfig) => StorageClient;
  },
): Promise<number> {
  if (parsed.positionals.length > 0) {
    throw new Error("status does not accept positional arguments");
  }

  const checks: StatusCheckResult[] = [];
  const envChecks = inspectEnv(options.env);
  const catalogPath = options.catalogPath ?? resolveCatalogPath(options.env, options.homeDir);

  if (parsed.flags.json) {
    for (const check of envChecks) {
      checks.push({ message: check.message, name: check.key, ok: check.ok });
    }
  } else {
    for (const check of envChecks) {
      emitEnvCheck(options.io, check);
    }
  }

  let dbOk = false;
  try {
    const catalog = new Catalog(catalogPath);
    catalog.ping();
    catalog.close();
    dbOk = true;
    if (parsed.flags.json) {
      checks.push({ message: catalogPath, name: "db", ok: true });
    } else {
      options.io.stdout(`ok\tdb\t${catalogPath}`);
    }
  } catch (error) {
    const message = getErrorMessage(error);
    if (parsed.flags.json) {
      checks.push({ message, name: "db", ok: false });
    } else {
      emitError(options.io, "db", message);
    }
  }

  let config: AppConfig | null = null;
  try {
    config = requireCoreConfig(options.env, {
      catalogPath: options.catalogPath,
      envFilePath: options.envFilePath,
      homeDir: options.homeDir,
    });
  } catch (error) {
    if (parsed.flags.json) {
      checks.push({ message: getErrorMessage(error), name: "core_config", ok: false });
      emitJson(options.io, {
        checks,
        ready: false,
        requiredEnv: getReadyEnvKeys(),
      });
      return 1;
    }

    options.io.stdout("not_ready");
    return 1;
  }

  let s3Ok = false;
  try {
    const storage = options.storageFactory(config);
    await storage.probe();
    s3Ok = true;
    if (parsed.flags.json) {
      checks.push({ message: config.bucket, name: "s3", ok: true });
    } else {
      options.io.stdout(`ok\ts3\t${config.bucket}`);
    }
  } catch (error) {
    const message = getErrorMessage(error);
    if (parsed.flags.json) {
      checks.push({ message, name: "s3", ok: false });
    } else {
      emitError(options.io, "s3", message);
    }
  }

  const ready = envChecks.every((check) => check.ok) && dbOk && s3Ok;
  if (parsed.flags.json) {
    emitJson(options.io, {
      checks,
      ready,
      requiredEnv: getReadyEnvKeys(),
    });
  } else {
    options.io.stdout(ready ? "ready" : "not_ready");
  }

  return ready ? 0 : 1;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (!command && !token.startsWith("-")) {
      command = token;
      continue;
    }

    if (token === "--json") {
      flags.json = true;
      continue;
    }

    if (token === "--help" || token === "-h") {
      flags.help = true;
      continue;
    }

    if (token === "--public") {
      flags.public = true;
      continue;
    }

    if (token === "--private") {
      flags.private = true;
      continue;
    }

    if (token === "--prefix" || token === "--expires") {
      const nextValue = argv[index + 1];
      if (nextValue === undefined || nextValue.startsWith("-")) {
        throw new Error(`missing value for ${token}`);
      }
      flags[token.slice(2)] = nextValue;
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`unknown flag ${token}`);
    }

    positionals.push(token);
  }

  return { command, flags, positionals };
}

function resolveVisibility(flags: Record<string, string | boolean>): Visibility {
  if (flags.public && flags.private) {
    throw new Error("choose either --public or --private");
  }

  return flags.public ? "public" : "private";
}

function readOptionalStringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function readOptionalPositiveIntegerFlag(
  flags: Record<string, string | boolean>,
  key: string,
): number | undefined {
  const value = readOptionalStringFlag(flags, key);
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid ${key} ${value}`);
  }

  return parsed;
}

async function promptRequiredValue(prompt: PromptLike, label: string, defaultValue?: string): Promise<string> {
  while (true) {
    const answer = (await prompt.ask(label, defaultValue)).trim();
    if (answer) {
      return answer;
    }
  }
}

function createPrompter(): PromptLike {
  const readline = createInterface({ input, output });
  return {
    ask: async (question: string, defaultValue?: string) => {
      const suffix = defaultValue ? ` [${defaultValue}]` : "";
      const answer = await readline.question(`${question}${suffix}: `);
      return answer.trim() || defaultValue || "";
    },
    close: () => readline.close(),
  };
}

function printHelp(io: CliIo): void {
  io.stdout("s3-storage-cli");
  io.stdout("setup [--json]");
  io.stdout("status [--json]");
  io.stdout("list|ls [prefix] [--json]");
  io.stdout("upload|up <paths...> [--public|--private] [--prefix <remote-prefix>] [--json]");
  io.stdout("delete|rm <keys...> [--json]");
  io.stdout("share|sh <key> [--expires <seconds>] [--json]");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
