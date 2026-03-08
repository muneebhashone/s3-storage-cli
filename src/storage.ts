import { S3Client } from "bun";
import type { AppConfig, Visibility } from "./config";

export interface UploadedRemoteMeta {
  contentType: string | null;
  etag: string | null;
  size: number;
}

export interface StorageClient {
  deleteObject(key: string): Promise<void>;
  getShareUrl(key: string, visibility: Visibility, expiresIn: number): Promise<string>;
  probe(): Promise<void>;
  uploadFile(localPath: string, key: string, visibility: Visibility): Promise<UploadedRemoteMeta>;
}

export class BunStorageClient implements StorageClient {
  private readonly client: S3Client;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.client = new S3Client({
      accessKeyId: config.accessKeyId,
      bucket: config.bucket,
      endpoint: config.endpoint,
      region: config.region,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
      virtualHostedStyle: config.virtualHostedStyle,
    });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.delete(key);
  }

  async getShareUrl(key: string, visibility: Visibility, expiresIn: number): Promise<string> {
    if (visibility === "public") {
      if (!this.config.publicBaseUrl) {
        throw new Error("missing env S3_PUBLIC_BASE_URL");
      }

      return buildPublicObjectUrl(this.config.publicBaseUrl, key);
    }

    return this.client.presign(key, {
      expiresIn,
      method: "GET",
    });
  }

  async probe(): Promise<void> {
    const probeKey = "__s3_storage_cli_status_probe__";
    await this.client.exists(probeKey);
  }

  async uploadFile(localPath: string, key: string, visibility: Visibility): Promise<UploadedRemoteMeta> {
    const file = Bun.file(localPath);
    const localType = file.type || undefined;
    await this.client.write(key, file, {
      acl: visibility === "public" ? "public-read" : "private",
      type: localType,
    });

    const remote = await this.client.stat(key);
    return {
      contentType: remote.type || localType || null,
      etag: remote.etag || null,
      size: remote.size,
    };
  }
}

export function buildPublicObjectUrl(baseUrl: string, key: string): string {
  const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const encodedKey = key
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const basePath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${basePath}${encodedKey}`.replace(/\/+/g, "/");
  return url.toString();
}
