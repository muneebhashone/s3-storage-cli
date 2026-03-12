---
name: s3-storage-cli
description: Use when working with the s3-storage-cli package for scoped S3 setup, readiness checks, tracked uploads, tracked listing or deletes, or share-link generation from the CLI.
---

# S3 Storage CLI

Use this skill when the task involves using `s3-storage-cli` to upload files to the configured S3-compatible bucket, list tracked files, delete tracked files, check readiness, or generate share links.

## Required env

- `S3_STORAGE_CLI_ENDPOINT`
- `S3_STORAGE_CLI_REGION`
- `S3_STORAGE_CLI_ACCESS_KEY_ID`
- `S3_STORAGE_CLI_SECRET_ACCESS_KEY`
- `S3_STORAGE_CLI_BUCKET`

`S3_STORAGE_CLI_PUBLIC_BASE_URL` is required for `status` to report fully ready and for public object sharing.

Optional env:

- `S3_STORAGE_CLI_DB_PATH`
- `S3_STORAGE_CLI_SHARE_TTL_SECONDS`
- `S3_STORAGE_CLI_SESSION_TOKEN`
- `S3_STORAGE_CLI_VIRTUAL_HOSTED_STYLE`
- `S3_STORAGE_CLI_ENV_PATH`

The preferred flow is `s3-storage setup`, which prompts for the required scoped values and writes them to the CLI-owned env file.

## Commands

- Install first with `npm install -g s3-storage-cli`
- `s3-storage setup`
- `s3-storage status`
- `s3-storage list [prefix]`
- `s3-storage upload <paths...> [--public|--private] [--prefix <remote-prefix>] [--name <filename>]`
- `s3-storage delete <keys...>`
- `s3-storage share <key> [--expires <seconds>]`

Short aliases are available: `ls`, `up`, `rm`, `sh`, `st`.

## Behavior

- `list` reads the local SQLite catalog only. It does not list the whole bucket.
- `delete` only deletes tracked keys that are still active in the catalog.
- `upload` preserves relative paths for directory uploads. Single-file uploads use the file basename unless `--name` is provided.
- `share` returns a direct URL for tracked public objects and a presigned URL for tracked private objects.
- Default output is compact plain text. Add `--json` for machine-readable output.

## Output contract

- Success output is terse and stable.
- Errors are one-line stderr records in the form `error<TAB>code<TAB>message`.
- `share` plain output is the URL only.
