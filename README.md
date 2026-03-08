# s3-storage-cli

Minimal Bun CLI for tracked S3 uploads.

Commands:

- `status` verifies env, SQLite, and S3 connectivity
- `list` shows only objects tracked by this CLI
- `upload` uploads one or more files or directories
- `delete` removes tracked objects
- `share` returns a direct public URL or a signed private URL

Required env:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET`

Required for full readiness and public sharing:

- `S3_PUBLIC_BASE_URL`

Optional env:

- `S3_CLI_DB_PATH`
- `S3_SHARE_TTL_SECONDS`
- `S3_SESSION_TOKEN`
- `S3_VIRTUAL_HOSTED_STYLE`

Run:

```bash
bun run index.ts status
```

Examples:

```bash
bun run index.ts upload ./file.txt
bun run index.ts upload ./assets --public --prefix site
bun run index.ts list
bun run index.ts share site/assets/logo.png
bun run index.ts delete site/assets/logo.png
```
