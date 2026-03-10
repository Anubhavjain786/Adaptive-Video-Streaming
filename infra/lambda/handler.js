"use strict";

const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

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

// Helper: convert a Readable stream to a Buffer
async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

exports.handler = async (event) => {
  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

  // Only process objects under originals/
  if (!key.startsWith("originals/")) {
    console.log("Skipping non-originals key:", key);
    return;
  }

  // --- Media type guard (Layer 1): file extension check ---
  const ALLOWED_VIDEO_EXTENSIONS = new Set([
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
    ".flv",
    ".wmv",
    ".m4v",
    ".mpeg",
    ".mpg",
    ".3gp",
  ]);
  const fileExt = path.extname(key).toLowerCase();
  if (!ALLOWED_VIDEO_EXTENSIONS.has(fileExt)) {
    console.warn(
      `Skipping "${key}" — unsupported extension "${fileExt}". Only video files are processed.`,
    );
    return;
  }

  // videoId = filename without extension — must match backend VideosService derivation
  const fileName = path.basename(key);
  const videoId = fileName.split(".")[0];
  const inputPath = `/tmp/${fileName}`;
  const outputDir = `/tmp/output`;

  console.log(`Processing videoId="${videoId}" from key="${key}"`);

  // 1. Download original to /tmp — SDK v3 returns body as a Readable stream
  const getResp = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );

  // --- Media type guard (Layer 2): S3 ContentType check ---
  const contentType = (getResp.ContentType || "").toLowerCase();
  if (
    contentType &&
    !contentType.startsWith("video/") &&
    contentType !== "application/octet-stream"
  ) {
    console.warn(
      `Skipping "${key}" — ContentType is "${contentType}", not a video. Aborting.`,
    );
    return;
  }

  const bodyBuffer = await streamToBuffer(getResp.Body);
  fs.writeFileSync(inputPath, bodyBuffer);

  // 2. Create output dir
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir);

  // 3. Transcode to HLS renditions
  const renditions = [
    { name: "240p", scale: "426:240", bitrate: "400k" },
    { name: "360p", scale: "640:360", bitrate: "800k" },
    { name: "480p", scale: "854:480", bitrate: "1200k" },
    { name: "720p", scale: "1280:720", bitrate: "2500k" },
    { name: "1080p", scale: "1920:1080", bitrate: "5000k" },
    { name: "2k", scale: "2560:1440", bitrate: "10000k" },
    { name: "4k", scale: "3840:2160", bitrate: "20000k" },
  ];

  const variants = [];

  for (const r of renditions) {
    const outPath = `${outputDir}/${r.name}`;
    fs.mkdirSync(outPath);

    // Segment naming: seg_%03d.ts  (e.g. seg_001.ts, seg_002.ts …)
    const args = [
      "-y",
      "-i",
      inputPath,
      "-vf",
      `scale=${r.scale}`,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-c:v",
      "h264",
      "-preset",
      "veryfast",
      "-b:v",
      r.bitrate,
      "-hls_time",
      "4",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      `${outPath}/seg_%03d.ts`,
      `${outPath}/playlist.m3u8`,
    ];

    console.log(`Transcoding ${r.name}…`);
    execFileSync(FFMPEG, args, { stdio: "inherit" });

    variants.push({
      bandwidth: parseInt(r.bitrate) * 1000,
      resolution: r.scale.replace(":", "x"),
      uri: `${r.name}/playlist.m3u8`,
    });
  }

  // 4. Generate HLS master playlist
  let master = "#EXTM3U\n";
  for (const v of variants) {
    master += `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},RESOLUTION=${v.resolution}\n${v.uri}\n`;
  }
  fs.writeFileSync(`${outputDir}/master.m3u8`, master);

  // 5. Upload all generated files to processed/<videoId>/
  // fs.readdirSync with { recursive: true } requires Node 18.x
  const files = fs.readdirSync(outputDir, { recursive: true });

  for (const file of files) {
    const fullPath = path.join(outputDir, file);
    if (fs.statSync(fullPath).isDirectory()) continue;

    const s3Key = `processed/${videoId}/${file}`;
    const contentType = file.endsWith(".m3u8")
      ? "application/vnd.apple.mpegurl"
      : "video/MP2T";

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: fs.readFileSync(fullPath),
        ContentType: contentType,
      }),
    );

    console.log(`Uploaded: ${s3Key}`);
  }

  console.log(
    `Done — video "${videoId}" is ready at processed/${videoId}/master.m3u8`,
  );
};
