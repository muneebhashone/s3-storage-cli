---
name: s3-storage-cli
description: Use this skill when you need to manage tracked uploads in this repository's S3 CLI. It covers status checks, tracked listing, uploads, deletes, and sharing links with token-efficient output.
---

# S3 Storage CLI

Use this repo's CLI when the task is uploading files to the configured S3-compatible bucket, listing only files previously uploaded through this CLI, deleting tracked files, checking readiness, or generating share links.

## Required env

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET`

`S3_PUBLIC_BASE_URL` is required for `status` to report fully ready and for public object sharing.

Optional env:

- `S3_CLI_DB_PATH`
- `S3_SHARE_TTL_SECONDS`
- `S3_SESSION_TOKEN`
- `S3_VIRTUAL_HOSTED_STYLE`

## Commands

- `bun run index.ts status`
- `bun run index.ts list [prefix]`
- `bun run index.ts upload <paths...> [--public|--private] [--prefix <remote-prefix>]`
- `bun run index.ts delete <keys...>`
- `bun run index.ts share <key> [--expires <seconds>]`

Short aliases are available: `ls`, `up`, `rm`, `sh`, `st`.

## Behavior

- `list` reads the local SQLite catalog only. It does not list the whole bucket.
- `delete` only deletes tracked keys that are still active in the catalog.
- `upload` preserves relative paths for directory uploads. Single-file uploads use the file basename.
- `share` returns a direct URL for tracked public objects and a presigned URL for tracked private objects.
- Default output is compact plain text. Add `--json` for machine-readable output.

## Output contract

- Success output is terse and stable.
- Errors are one-line stderr records in the form `error<TAB>code<TAB>message`.
- `share` plain output is the URL only.
