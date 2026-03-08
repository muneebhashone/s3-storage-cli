import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Catalog } from "./catalog";
import { inspectEnv, requireCoreConfig } from "./config";
import { resolveUploadTargets } from "./files";
import { runCli } from "./cli";
import { buildPublicObjectUrl, type StorageClient, type UploadedRemoteMeta } from "./storage";

class FakeStorageClient implements StorageClient {
  deleted: string[] = [];
  failProbe = false;
  sharedUrls = new Map<string, string>();
  uploaded: Array<{ key: string; localPath: string }> = [];

  async deleteObject(key: string): Promise<void> {
    this.deleted.push(key);
  }

  async getShareUrl(key: string): Promise<string> {
    return this.sharedUrls.get(key) ?? `https://signed.example/${key}`;
  }

  async probe(): Promise<void> {
    if (this.failProbe) {
      throw new Error("probe failed");
    }
  }

  async uploadFile(localPath: string, key: string): Promise<UploadedRemoteMeta> {
    this.uploaded.push({ key, localPath });
    return {
      contentType: "text/plain",
      etag: `"${key}"`,
      size: 5,
    };
  }
}

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stderr: (line: string) => stderr.push(line),
      stdout: (line: string) => stdout.push(line),
    },
    stderr,
    stdout,
  };
}

const baseEnv = {
  S3_ACCESS_KEY_ID: "key",
  S3_BUCKET: "bucket",
  S3_ENDPOINT: "https://example.invalid",
  S3_PUBLIC_BASE_URL: "https://cdn.example.com/assets",
  S3_REGION: "auto",
  S3_SECRET_ACCESS_KEY: "secret",
};

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "s3-storage-cli-"));
});

afterEach(() => {
  tempRoot = "";
});

describe("config", () => {
  test("inspectEnv marks missing vars", () => {
    const checks = inspectEnv({ S3_BUCKET: "bucket" });
    expect(checks.find((check) => check.key === "S3_BUCKET")?.ok).toBe(true);
    expect(checks.find((check) => check.key === "S3_ENDPOINT")?.ok).toBe(false);
  });

  test("requireCoreConfig resolves default ttl and catalog path", () => {
    const config = requireCoreConfig(baseEnv, { homeDir: tempRoot });
    expect(config.shareTtlSeconds).toBe(3600);
    expect(config.catalogPath).toContain(".s3-storage-cli");
  });
});

describe("storage", () => {
  test("buildPublicObjectUrl encodes each path segment", () => {
    expect(buildPublicObjectUrl("https://cdn.example.com/root", "dir/my file.txt")).toBe(
      "https://cdn.example.com/root/dir/my%20file.txt",
    );
  });
});

describe("files", () => {
  test("resolveUploadTargets preserves directory paths", async () => {
    const nestedDir = join(tempRoot, "photos", "raw");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(nestedDir, "image.txt"), "hello");

    const targets = await resolveUploadTargets(["photos"], {
      cwd: tempRoot,
      prefix: "uploads",
    });

    expect(targets).toEqual([
      {
        absolutePath: join(tempRoot, "photos", "raw", "image.txt"),
        key: "uploads/photos/raw/image.txt",
        sourcePath: join(tempRoot, "photos", "raw", "image.txt"),
      },
    ]);
  });
});

describe("catalog", () => {
  test("soft delete hides objects and reupload restores them", () => {
    const dbPath = join(tempRoot, "catalog.sqlite");
    const catalog = new Catalog(dbPath);

    catalog.upsertObject({
      bucket: "bucket",
      contentType: "text/plain",
      etag: '"etag-1"',
      key: "a.txt",
      size: 5,
      sourcePath: "C:/tmp/a.txt",
      uploadedAt: "2026-03-08T00:00:00.000Z",
      visibility: "private",
    });
    catalog.softDeleteObject("bucket", "a.txt", "2026-03-08T00:01:00.000Z");
    expect(catalog.listObjects("bucket")).toEqual([]);

    catalog.upsertObject({
      bucket: "bucket",
      contentType: "text/plain",
      etag: '"etag-2"',
      key: "a.txt",
      size: 6,
      sourcePath: "C:/tmp/a.txt",
      uploadedAt: "2026-03-08T00:02:00.000Z",
      visibility: "public",
    });

    expect(catalog.listObjects("bucket")).toEqual([
      {
        contentType: "text/plain",
        etag: '"etag-2"',
        key: "a.txt",
        size: 6,
        sourcePath: "C:/tmp/a.txt",
        uploadedAt: "2026-03-08T00:02:00.000Z",
        visibility: "public",
      },
    ]);

    catalog.close();
  });
});

describe("cli", () => {
  test("status emits ready json when env, db, and s3 checks pass", async () => {
    const fakeStorage = new FakeStorageClient();
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["status", "--json"], {
      catalogPath: join(tempRoot, "catalog.sqlite"),
      env: baseEnv,
      io,
      storageFactory: () => fakeStorage,
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0]!)).toEqual({
      checks: [
        { message: undefined, name: "S3_ENDPOINT", ok: true },
        { message: undefined, name: "S3_REGION", ok: true },
        { message: undefined, name: "S3_ACCESS_KEY_ID", ok: true },
        { message: undefined, name: "S3_SECRET_ACCESS_KEY", ok: true },
        { message: undefined, name: "S3_BUCKET", ok: true },
        { message: undefined, name: "S3_PUBLIC_BASE_URL", ok: true },
        { message: join(tempRoot, "catalog.sqlite"), name: "db", ok: true },
        { message: "bucket", name: "s3", ok: true },
      ],
      ready: true,
      requiredEnv: [
        "S3_ENDPOINT",
        "S3_REGION",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "S3_BUCKET",
        "S3_PUBLIC_BASE_URL",
      ],
    });
  });

  test("upload stores record and list returns tracked entries only", async () => {
    const dbPath = join(tempRoot, "catalog.sqlite");
    const localFile = join(tempRoot, "hello.txt");
    await writeFile(localFile, "hello");

    const fakeStorage = new FakeStorageClient();
    const uploadIo = createIo();
    const uploadCode = await runCli(["upload", "hello.txt"], {
      catalogPath: dbPath,
      cwd: tempRoot,
      env: baseEnv,
      io: uploadIo.io,
      now: () => new Date("2026-03-08T00:00:00.000Z"),
      storageFactory: () => fakeStorage,
    });

    expect(uploadCode).toBe(0);
    expect(uploadIo.stdout).toEqual(["uploaded\thello.txt\tprivate\t5"]);

    const listIo = createIo();
    const listCode = await runCli(["list"], {
      catalogPath: dbPath,
      env: baseEnv,
      io: listIo.io,
      storageFactory: () => fakeStorage,
    });

    expect(listCode).toBe(0);
    expect(listIo.stdout).toEqual(["hello.txt\tprivate\t5\t2026-03-08T00:00:00.000Z"]);
  });

  test("share returns direct url for tracked public objects", async () => {
    const dbPath = join(tempRoot, "catalog.sqlite");
    const catalog = new Catalog(dbPath);
    catalog.upsertObject({
      bucket: "bucket",
      contentType: "text/plain",
      etag: '"etag"',
      key: "public/readme.txt",
      size: 5,
      sourcePath: "C:/tmp/readme.txt",
      uploadedAt: "2026-03-08T00:00:00.000Z",
      visibility: "public",
    });
    catalog.close();

    const fakeStorage = new FakeStorageClient();
    fakeStorage.sharedUrls.set("public/readme.txt", "https://cdn.example.com/public/readme.txt");

    const { io, stdout } = createIo();
    const exitCode = await runCli(["share", "public/readme.txt"], {
      catalogPath: dbPath,
      env: baseEnv,
      io,
      storageFactory: () => fakeStorage,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(["https://cdn.example.com/public/readme.txt"]);
  });

  test("delete fails for untracked keys and returns non-zero", async () => {
    const { io, stderr } = createIo();
    const exitCode = await runCli(["delete", "missing.txt"], {
      catalogPath: join(tempRoot, "catalog.sqlite"),
      env: baseEnv,
      io,
      storageFactory: () => new FakeStorageClient(),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(["error\tdelete\tuntracked key missing.txt"]);
  });
});
