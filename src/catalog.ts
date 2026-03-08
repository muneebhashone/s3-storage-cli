import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { Visibility } from "./config";

export interface CatalogRecord {
  bucket: string;
  contentType: string | null;
  etag: string | null;
  key: string;
  size: number;
  sourcePath: string;
  uploadedAt: string;
  visibility: Visibility;
}

export interface ListedObject {
  contentType: string | null;
  etag: string | null;
  key: string;
  size: number;
  sourcePath: string;
  uploadedAt: string;
  visibility: Visibility;
}

export class Catalog {
  private readonly db: Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run("PRAGMA synchronous = NORMAL;");
    this.init();
  }

  close(): void {
    this.db.close();
  }

  ping(): void {
    this.db.query("SELECT 1 AS ok").get();
  }

  upsertObject(record: CatalogRecord): void {
    this.db.run(
      `
        INSERT INTO objects (
          bucket,
          key,
          visibility,
          size,
          etag,
          content_type,
          source_path,
          uploaded_at,
          deleted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(bucket, key)
        DO UPDATE SET
          visibility = excluded.visibility,
          size = excluded.size,
          etag = excluded.etag,
          content_type = excluded.content_type,
          source_path = excluded.source_path,
          uploaded_at = excluded.uploaded_at,
          deleted_at = NULL
      `,
      [
        record.bucket,
        record.key,
        record.visibility,
        record.size,
        record.etag,
        record.contentType,
        record.sourcePath,
        record.uploadedAt,
      ],
    );
  }

  listObjects(bucket: string, prefix?: string): ListedObject[] {
    return this.db
      .query<ListedObject, { bucket: string; prefix: string | null }>(
        `
          SELECT
            key,
            visibility,
            size,
            etag,
            content_type AS contentType,
            source_path AS sourcePath,
            uploaded_at AS uploadedAt
          FROM objects
          WHERE bucket = $bucket
            AND deleted_at IS NULL
            AND ($prefix IS NULL OR key LIKE $prefix || '%')
          ORDER BY key ASC
        `,
      )
      .all({ bucket, prefix: prefix ?? null });
  }

  getObject(bucket: string, key: string): ListedObject | null {
    return (
      this.db
        .query<ListedObject, { bucket: string; key: string }>(
          `
            SELECT
              key,
              visibility,
              size,
              etag,
              content_type AS contentType,
              source_path AS sourcePath,
              uploaded_at AS uploadedAt
            FROM objects
            WHERE bucket = $bucket
              AND key = $key
              AND deleted_at IS NULL
            LIMIT 1
          `,
        )
        .get({ bucket, key }) ?? null
    );
  }

  softDeleteObject(bucket: string, key: string, deletedAt: string): void {
    this.db.run(
      `
        UPDATE objects
        SET deleted_at = ?
        WHERE bucket = ?
          AND key = ?
          AND deleted_at IS NULL
      `,
      [deletedAt, bucket, key],
    );
  }

  private init(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS objects (
        bucket TEXT NOT NULL,
        key TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK (visibility IN ('private', 'public')),
        size INTEGER NOT NULL,
        etag TEXT,
        content_type TEXT,
        source_path TEXT NOT NULL,
        uploaded_at TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (bucket, key)
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_objects_bucket_deleted_key
      ON objects (bucket, deleted_at, key)
    `);
  }
}
