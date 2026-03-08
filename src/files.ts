import { lstat, readdir } from "node:fs/promises";
import { basename, posix, relative, resolve } from "node:path";

export interface UploadTarget {
  absolutePath: string;
  key: string;
  sourcePath: string;
}

export async function resolveUploadTargets(
  inputPaths: string[],
  options: { cwd: string; prefix?: string },
): Promise<UploadTarget[]> {
  if (inputPaths.length === 0) {
    throw new Error("upload requires at least one path");
  }

  const prefix = normalizePrefix(options.prefix);
  const targets: UploadTarget[] = [];

  for (const inputPath of inputPaths) {
    const absoluteInputPath = resolve(options.cwd, inputPath);
    const stats = await lstat(absoluteInputPath).catch(() => null);
    if (!stats) {
      throw new Error(`path not found ${inputPath}`);
    }

    if (stats.isDirectory()) {
      const directoryName = basename(absoluteInputPath);
      const entries = await walkDirectory(absoluteInputPath);
      for (const filePath of entries) {
        const relativeInsideDirectory = toS3Key(relative(absoluteInputPath, filePath));
        targets.push({
          absolutePath: filePath,
          key: `${prefix}${toS3Key(posix.join(directoryName, relativeInsideDirectory))}`,
          sourcePath: filePath,
        });
      }
      continue;
    }

    if (!stats.isFile()) {
      throw new Error(`unsupported path ${inputPath}`);
    }

    targets.push({
      absolutePath: absoluteInputPath,
      key: `${prefix}${toS3Key(basename(absoluteInputPath))}`,
      sourcePath: absoluteInputPath,
    });
  }

  if (targets.length === 0) {
    throw new Error("no files found");
  }

  assertNoDuplicateKeys(targets);
  return targets;
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix?.trim()) {
    return "";
  }

  return toS3Key(prefix.trim()).replace(/^\/+/, "").replace(/\/?$/, "/");
}

function toS3Key(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

async function walkDirectory(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDirectory(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function assertNoDuplicateKeys(targets: UploadTarget[]): void {
  const seen = new Map<string, string>();
  for (const target of targets) {
    const previous = seen.get(target.key);
    if (previous) {
      throw new Error(`duplicate key ${target.key} from ${previous} and ${target.sourcePath}`);
    }
    seen.set(target.key, target.sourcePath);
  }
}
