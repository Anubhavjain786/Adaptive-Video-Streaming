---
name: Adaptive Video Streaming
description: Describe when to use this prompt
---

You are a senior staff-level full-stack engineer and cloud architect.

Your task is to generate a complete working monorepo for an Adaptive Video Streaming POC similar to YouTube’s architecture, using AWS serverless infrastructure.

The project must be production-quality but optimized for a proof-of-concept.

GOAL

Build a system where:

User uploads original video to S3 under "originals/" folder

S3 event triggers Lambda automatically

Lambda transcodes video into multiple resolutions using FFmpeg

Output stored in "processed/<videoId>/"

HLS playlists generated (master + variants)

React frontend streams video adaptively using HLS

Backend provides upload URLs and playback metadata

Entire infrastructure managed via Serverless Framework (serverless.yml)

No manual AWS console setup required

TECH STACK

Backend:

NestJS (Node.js, TypeScript)

Frontend:

React (Vite)

hls.js player

Cloud:

AWS S3

AWS Lambda

Serverless Framework (CloudFormation)

Transcoding:

FFmpeg static binary in Lambda Layer

Streaming:

HLS (HTTP Live Streaming)

Adaptive Bitrate (ABR)

MONOREPO STRUCTURE

Create a single repository with the following layout:

root/
apps/
backend/ -> NestJS API
frontend/ -> React app
infra/
lambda/ -> transcoder function
layers/
ffmpeg/ -> ffmpeg binary
serverless.yml
README.md

S3 BUCKET DESIGN

Single bucket auto-created by Serverless:

video-streaming-poc-${stage}

Folder structure inside bucket:

originals/ -> uploaded source videos
processed/ -> transcoded HLS outputs

TRANSCODING REQUIREMENTS

Lambda must:

Trigger on S3 ObjectCreated events

Only process objects with prefix "originals/"

Download video to /tmp

Generate HLS renditions:

360p — ~800 kbps
480p — ~1200 kbps
720p — ~2500 kbps

Segment duration: 4 seconds

Codec: H.264 video + AAC audio

Generate:

processed/<videoId>/
master.m3u8
360p/playlist.m3u8 + segments
480p/playlist.m3u8 + segments
720p/playlist.m3u8 + segments

Upload all output files back to S3

Do not modify original file

SERVERLESS INFRA REQUIREMENTS

serverless.yml must:

Create S3 bucket

Create Lambda function

Create IAM role with least privilege

Attach FFmpeg Lambda Layer

Configure S3 event trigger

Set memory >= 2048 MB

Timeout >= 900 seconds

Deployment command should be:

serverless deploy --stage dev

BACKEND REQUIREMENTS (NestJS)

Implement APIs:

POST /videos/upload-url

Generates S3 presigned PUT URL

Upload key format: originals/<uuid>.mp4

Returns uploadUrl, key, videoId

GET /videos/:id

Returns playback URL for HLS master playlist

URL format:
https://<bucket>.s3.amazonaws.com/processed/<id>/master.m3u8

Code should use AWS SDK v3.

FRONTEND REQUIREMENTS (React)

Create pages:

UPLOAD PAGE

File picker

Upload file via presigned URL

Show progress indicator

Display generated video ID

PLAYER PAGE

Input video ID

Fetch playback URL from backend

Play video using hls.js

Adaptive bitrate enabled

Show current quality level in console

PLAYER BEHAVIOR

Use hls.js with:

Automatic quality switching

Start level auto

Handle unsupported browsers (fallback to native HLS)

Optional:

Display available quality levels

Log level switches

FFMPEG LAYER REQUIREMENTS

Expect FFmpeg binary at:

/opt/bin/ffmpeg

Do not download FFmpeg at runtime.

CORS REQUIREMENTS

Configure S3 bucket to allow:

PUT from frontend origin

GET for streaming

CODE QUALITY REQUIREMENTS

Use TypeScript for backend

Use modern React with hooks

Clean folder structure

Meaningful variable names

Error handling included

Comments explaining key logic

Production-style formatting

README REQUIREMENTS

Generate a README.md explaining:

Project overview

Architecture diagram (ASCII is fine)

Setup instructions

Deployment steps

How to test end-to-end

Future production improvements

SUCCESS CRITERIA

After deployment:

User uploads a video via frontend

File stored in originals/

Lambda runs automatically

HLS output generated in processed/

Video plays in browser

Player adapts quality based on bandwidth

IMPORTANT CONSTRAINTS

This is a POC, not a full production system

Prefer simplicity over enterprise complexity

Avoid unnecessary AWS services

Do not include MediaConvert

Do not use databases

Everything must be serverless-friendly

OUTPUT FORMAT

Generate complete working code for:

Monorepo structure

Backend

Frontend

Lambda

Serverless config

README

All files should be ready to run with minimal changes.

END OF TASK
