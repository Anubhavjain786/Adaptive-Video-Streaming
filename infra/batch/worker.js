"use strict";

const { S3Client } = require("@aws-sdk/client-s3");
const { transcodeObject } = require("../lib/transcode");

const s3 = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1",
  ...(process.env.LOCALSTACK_HOSTNAME && {
    endpoint: `http://${process.env.LOCALSTACK_HOSTNAME}:4566`,
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  }),
});

async function main() {
  const bucket = process.env.SOURCE_BUCKET;
  const key = process.env.SOURCE_KEY;
  const ffmpegPath = process.env.FFMPEG_PATH || "/usr/local/bin/ffmpeg";

  if (!bucket || !key) {
    throw new Error(
      "SOURCE_BUCKET and SOURCE_KEY must be provided to the Batch worker.",
    );
  }

  await transcodeObject({ bucket, key, s3, ffmpegPath });
}

main().catch((error) => {
  console.error("Batch transcoder failed", error);
  process.exitCode = 1;
});
