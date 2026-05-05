# Architecture

This project is a serverless proof of concept for adaptive video delivery. A client uploads a raw video directly to S3, a lightweight Lambda submits an AWS Batch job backed by an ECR container, and playback is served through a NestJS proxy so S3 media can remain private.

## System Overview

### Runtime pieces

- React + Vite web client for upload and playback
- Flutter client for mobile upload and playback
- NestJS backend for presigned upload URLs and HLS proxying
- AWS Batch transcoder job that runs an ECR container with FFmpeg
- Lightweight Lambda that submits Batch jobs when new source objects arrive
- Amazon S3 for original uploads and processed HLS outputs
- Serverless Framework v3 for infrastructure deployment

### Main flow

1. Client requests `POST /videos/upload-url` from the backend.
2. Backend returns a presigned S3 PUT URL plus a derived `videoId`.
3. Client uploads the source video directly to `originals/<filename>`.
4. S3 object creation triggers a lightweight submitter Lambda.
5. The submitter calls `SubmitJob` on AWS Batch.
6. AWS Batch pulls the transcoder image from ECR, streams the source video from S3 with a presigned URL, and writes HLS outputs.
7. The Batch worker uploads `master.m3u8`, variant playlists, and `.ts` segments into `processed/<videoId>/`.
8. Client requests `GET /videos/:id` to obtain the backend playback URL.
9. Video player loads playlists and segments through `GET /videos/hls/*`.

## Monorepo Structure

```text
apps/
  backend/          NestJS API
  frontend/         React + Vite client
  flutter_app/      Flutter client
infra/
  lambda/           Local transcoder + Batch job submitter Lambdas
  batch/            AWS Batch worker image source
  lib/              Shared transcoding logic
  layers/ffmpeg/    FFmpeg binary reused locally and in the Batch image
  serverless.yml    Infrastructure definition
test/
  e2e-test.sh       Local end-to-end validation
```

## Backend Responsibilities

The NestJS API is intentionally narrow.

- `POST /videos/upload-url` returns a presigned PUT URL for direct upload to S3.
- `GET /videos/:id` returns the playback entrypoint for a processed stream.
- `GET /videos/hls/*` proxies playlists and transport stream segments from S3.

The proxy route rewrites relative paths inside `.m3u8` files so the browser continues to fetch all HLS assets through the backend.

## Transcoder Responsibilities

The real AWS transcoder runs from `infra/batch/worker.js`, while `infra/lambda/handler.js` is retained for the LocalStack path only. Both call into the shared module in `infra/lib/transcode.js`.

- reads the uploaded object from `originals/`
- derives `videoId` from the filename without the extension
- streams the source object from S3 using a presigned GET URL
- runs FFmpeg once per rendition
- emits HLS playlists and MPEG-TS segments
- writes the final structure under `processed/<videoId>/`

### Rendition ladder

| Rendition | Scale | Video bitrate | Audio bitrate | Segment duration |
| --- | --- | --- | --- | --- |
| 360p | 640:360 | 800k | 128k AAC | 4 seconds |
| 480p | 854:480 | 1200k | 128k AAC | 4 seconds |
| 720p | 1280:720 | 2500k | 128k AAC | 4 seconds |
| 1080p | 1920:1080 | 5000k | 128k AAC | 4 seconds |
| 2k | 2560:1440 | 10000k | 128k AAC | 4 seconds |
| 4k | 3840:2160 | 20000k | 128k AAC | 4 seconds |

The FFmpeg preset is `ultrafast`, which is appropriate for a POC where turnaround time matters more than compression efficiency.

## Storage Layout

The project uses a single bucket defined by `AWS_BUCKET_NAME`.

```text
originals/
  myvideo.mp4

processed/
  myvideo/
    master.m3u8
    360p/
      playlist.m3u8
      seg_001.ts
    480p/
      playlist.m3u8
      seg_001.ts
    720p/
      playlist.m3u8
      seg_001.ts
    1080p/
      playlist.m3u8
      seg_001.ts
    2k/
      playlist.m3u8
      seg_001.ts
    4k/
      playlist.m3u8
      seg_001.ts
```

Content types are assigned as:

- `.m3u8` -> `application/vnd.apple.mpegurl`
- `.ts` -> `video/MP2T`

## Deployment Modes

### AWS deployment

- Builds the transcoder image from `infra/batch/Dockerfile` and pushes it to Amazon ECR.
- Deploys AWS Batch Fargate resources, a submitter Lambda, and the rest of the stack with Serverless Framework.
- Requires AWS credentials, Docker, and either a default VPC or explicit `BATCH_SUBNET_IDS` / `BATCH_SECURITY_GROUP_IDS`.

### LocalStack deployment

- Deploys the bucket and trigger wiring to LocalStack with `--stage local`.
- Backend switches to the LocalStack S3 endpoint when `STAGE=local` is set.
- Local transcoding uses the retained Lambda path with system FFmpeg via `FFMPEG_PATH=$(which ffmpeg)`.
- The e2e script invokes the Lambda handler locally instead of trying to emulate AWS Batch.

That last choice is deliberate: LocalStack Lambda executes in Linux, while Homebrew FFmpeg on macOS is a local binary.

## Operational Notes

- `infra` is intentionally excluded from npm workspaces so its Lambda dependencies are bundled correctly during Serverless packaging.
- The backend S3 client disables automatic checksum injection in presigned URLs to avoid upload failures from browser and curl clients.
- IAM permissions are intentionally broad for POC simplicity.
- `videoId` collisions are possible because IDs are filename-derived.
- Large source files now rely on AWS Batch job sizing instead of Lambda's 15-minute timeout ceiling.

## Testing Path

The fastest full-system validation loop is:

```bash
npm run localstack:up
npm run deploy:local
npm run backend:local
npm run frontend
bash test/e2e-test.sh
```

This exercises presigned upload generation, upload to LocalStack S3, local transcoding, HLS output verification, and final playback URL generation.
