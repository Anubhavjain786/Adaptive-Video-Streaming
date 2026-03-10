# Copilot Instructions — Adaptive Video Streaming

## Project Overview

YouTube-style adaptive video streaming POC on AWS serverless infrastructure. Author: Anubhav Jain.  
Scaffolded from [.github/prompts/Adaptive Video Streaming.prompt.md](.github/prompts/Adaptive Video Streaming.prompt.md). Architecture details in [ARCHITECTURE.md](../ARCHITECTURE.md).

## Monorepo Structure

```
apps/
  backend/          # NestJS API (TypeScript) — presigned URLs + playback metadata
  frontend/         # React + Vite — upload UI + hls.js player
infra/
  lambda/
    handler.js      # Transcoder Lambda (plain JS, AWS SDK v3)
  layers/
    ffmpeg/bin/ffmpeg  # Static FFmpeg binary — must be chmod +x
  serverless.yml    # All AWS infra (Serverless Framework v3)
  package.json      # Standalone — NOT part of npm workspaces (needs isolated node_modules)
  node_modules/     # infra has its own node_modules (@aws-sdk/client-s3)
package.json        # npm workspaces root — workspaces: [apps/backend, apps/frontend]
                    # infra is excluded from workspaces so Serverless bundles its deps correctly
```

## Developer Workflow

```bash
npm install              # install all workspace deps from root
npm run backend          # start NestJS on :3000 (watch mode)
npm run frontend         # start Vite dev server on :5173 (proxies /videos → :3000)
npm run deploy           # cd infra && serverless deploy --stage dev
```

## Local Testing with LocalStack

Full end-to-end testing without a real AWS account using [docker-compose.yml](../docker-compose.yml):

```bash
# Prerequisites
brew install ffmpeg                    # Lambda runs locally, uses system ffmpeg
npm install -g serverless

# 1. Start LocalStack (S3 + Lambda emulation)
npm run localstack:up                 # docker compose up -d localstack

# 2. Deploy infra to LocalStack (stage=local → serverless-localstack plugin kicks in)
npm run deploy:local                  # cd infra && npm install && FFMPEG_PATH=$(which ffmpeg) npx serverless deploy --stage local

# 3. Start backend pointing at LocalStack
npm run backend:local                 # STAGE=local → SDK points to http://localhost:4566

# 4. Start frontend (unchanged)
npm run frontend                      # http://localhost:5173

# 5. Trigger transcoding via the e2e test script
bash test/e2e-test.sh                 # upload → invoke local → verify HLS in S3

# 6. Open player and enter videoId: samplevideo
# http://localhost:5173/play

# 7. Tear down
npm run localstack:down
```

**How LocalStack integration works:**

- `serverless-localstack` plugin intercepts `--stage local` and redirects all AWS API calls to `localhost:4566`
- `LOCALSTACK_HOSTNAME` env var is injected into Lambda functions by LocalStack — handler.js uses it to configure the SDK v3 endpoint with `forcePathStyle: true`
- `STAGE=local` on the backend switches the SDK v3 client to `forcePathStyle: true` + `endpoint: http://localhost:4566`
- Playback URLs change from `https://<bucket>.s3.amazonaws.com/...` to `http://localhost:4566/<bucket>/...`
- `FFMPEG_PATH` env var overrides the `/opt/bin/ffmpeg` default so the local system ffmpeg is used
- **Lambda transcoding is invoked via `serverless invoke local`** (not through LocalStack Lambda), because LocalStack's Lambda executor runs inside Linux but Homebrew ffmpeg is a macOS binary
- `docker-compose.yml` has no `SERVICES` restriction — all community-tier services (S3, Lambda, CloudFormation, IAM, logs) start by default
- **`infra` is excluded from npm workspaces** — run `cd infra && npm install` before deploying; this ensures `@aws-sdk/client-s3` lives in `infra/node_modules/` and gets bundled into the Lambda zip

## Data Flow

1. Frontend calls `POST /videos/upload-url` → backend returns S3 presigned PUT URL + `videoId`
2. Frontend PUTs raw video to `s3://video-streaming-poc-{stage}/originals/<filename>.mp4`
3. S3 `ObjectCreated` event triggers Lambda (prefix filter: `originals/`)
4. Lambda: download to `/tmp` → FFmpeg → HLS segments → upload to `processed/<videoId>/`
5. Frontend calls `GET /videos/:id` → backend returns `https://<bucket>.s3.amazonaws.com/processed/<id>/master.m3u8`
6. hls.js player streams from S3 with automatic quality switching

## videoId Derivation

`videoId = path.basename(key).split(".")[0]` — the filename without extension, **not** a UUID.  
Upload key `originals/myvideo.mp4` → `videoId = "myvideo"` → output at `processed/myvideo/`.

## S3 Bucket Layout

Single bucket `video-streaming-poc-${sls:stage}` (created by Serverless Framework):

```
originals/          # raw uploads — Lambda trigger source
processed/
  <videoId>/
    master.m3u8
    360p/playlist.m3u8 + seg_001.ts seg_002.ts …
    480p/playlist.m3u8 + seg_001.ts seg_002.ts …
    720p/playlist.m3u8 + seg_001.ts seg_002.ts …
```

Segment naming pattern: `seg_%03d.ts`. Content-Types: `application/vnd.apple.mpegurl` (`.m3u8`), `video/MP2T` (`.ts`).

## HLS Rendition Specs

| Rendition | Scale    | Bitrate | Segment | Codec       |
| --------- | -------- | ------- | ------- | ----------- |
| 360p      | 640:360  | 800k    | 4s      | H.264 + AAC |
| 480p      | 854:480  | 1200k   | 4s      | H.264 + AAC |
| 720p      | 1280:720 | 2500k   | 4s      | H.264 + AAC |

FFmpeg preset: `-preset veryfast`. Audio: `-c:a aac -b:a 128k`.

## Lambda Conventions (`infra/lambda/handler.js`)

- Plain JS, AWS SDK **v3** (`@aws-sdk/client-s3` with `s3.send(new GetObjectCommand(...))`)
- `@aws-sdk/client-s3` is a direct dep in `infra/package.json` — **infra is NOT in npm workspaces** so Serverless Framework bundles it into the Lambda zip
- FFmpeg at `/opt/bin/ffmpeg` via Lambda Layer — override with `FFMPEG_PATH` env var for local runs
- Working dir `/tmp`; `fs.readdirSync(outputDir, { recursive: true })` requires Node 18.x
- IAM uses broad `s3:*` on `"*"` intentionally for POC simplicity
- When `LOCALSTACK_HOSTNAME` env var is set, S3 client uses `forcePathStyle: true` + `http://localhost:4566`
- Do **not** modify the original file in `originals/`

## Backend API (NestJS + AWS SDK v3)

- `POST /videos/upload-url` — returns `{ uploadUrl, key, videoId }`
- `GET /videos/:id` — returns playback URL for `processed/<id>/master.m3u8`
- Use AWS SDK **v3** (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) — Lambda also uses v3
- S3Client is configured with `requestChecksumCalculation: 'WHEN_REQUIRED'` to prevent SDK v3 from embedding a CRC32 checksum placeholder in presigned URLs (which causes 400 errors on upload from non-SDK clients like browsers/curl)

## Frontend Conventions (React + Vite + hls.js)

- Upload page: file picker → PUT to presigned URL → show `videoId`
- Player page: input `videoId` → fetch playback URL → `hls.js` with `startLevel: -1` (auto ABR)
- Fallback to native `<video>` HLS on Safari (`Hls.isSupported()` check)
- Log quality level switches to console

## Infrastructure

```bash
npm install                             # install all workspace deps
npm install -g serverless               # one-time global install
aws configure                           # set credentials (region: ap-south-1)
chmod +x infra/layers/ffmpeg/bin/ffmpeg # required before deploy
cd infra && serverless deploy --stage dev  # deploys bucket, Lambda, IAM, layer, S3 trigger
```

- Serverless Framework **v3** (`frameworkVersion: "3"`), runtime `nodejs18.x`, region `ap-south-1`
- `serverless.yml` lives in `infra/` — run `serverless` commands from that directory
- FFmpeg static binary source: https://johnvansickle.com/ffmpeg/

## CORS

- S3 bucket CORS: allow `PUT` from frontend origin + `GET` for streaming
- NestJS backend: enable CORS for the frontend dev origin
