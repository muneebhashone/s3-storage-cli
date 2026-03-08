# s3-storage-cli

Minimal Bun CLI for tracked S3 uploads.

Install:

```bash
npm install -g s3-storage-cli
```

Runtime requirement:

- `bun` must be installed because the published CLI executes with Bun

Install without global npm setup:

```bash
npx s3-storage-cli status
```

Quick start:

```bash
s3-storage status
```

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

Examples:

```bash
s3-storage upload ./file.txt
s3-storage upload ./assets --public --prefix site
s3-storage list
s3-storage share site/assets/logo.png
s3-storage delete site/assets/logo.png
```

## Agent Skill

This repo is also compatible with `skills.sh` style skill installers.

List the skill from GitHub:

```bash
npx skills add muneebhashone/s3-storage-cli -l
```

Install the skill:

```bash
npx skills add muneebhashone/s3-storage-cli --skill s3-storage-cli
```
