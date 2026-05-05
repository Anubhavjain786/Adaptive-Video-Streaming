"use strict";

const { S3Client } = require("@aws-sdk/client-s3");
const { transcodeObject } = require("../lib/transcode");

// When running inside LocalStack, LOCALSTACK_HOSTNAME is injected automatically.
// FFMPEG_PATH lets us override the binary path per-environment:
//   - Real Lambda layer: /opt/bin/ffmpeg (default)
//   - LocalStack local executor on macOS: /usr/local/bin/ffmpeg (Homebrew)
const FFMPEG = process.env.FFMPEG_PATH || "/opt/bin/ffmpeg";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1",
  ...(process.env.LOCALSTACK_HOSTNAME && {
    endpoint: `http://${process.env.LOCALSTACK_HOSTNAME}:4566`,
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  }),
});

exports.handler = async (event) => {
  if (process.env.STAGE !== "local") {
    console.log("Skipping Lambda transcoder outside local stage.");
    return;
  }

  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
  await transcodeObject({ bucket, key, s3, ffmpegPath: FFMPEG });
};
