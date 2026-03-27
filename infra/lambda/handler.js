"use strict";

const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
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

  // Generic mapping:
  //   originals/<relativePath>.<ext> -> processed/<relativePath>/
  const relativeKey = key.slice("originals/".length);
  const assetPath = relativeKey.slice(0, -fileExt.length);
  if (!assetPath) {
    console.warn(`Unable to derive assetPath from key="${key}"`);
    return;
  }
  const outputDir = `/tmp/output`;

  console.log(`Processing assetPath="${assetPath}" from key="${key}"`);

  // 1. Check ContentType without downloading the body
  const headResp = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  // Consume and discard body immediately — we only needed the headers
  headResp.Body.destroy();

  // --- Media type guard (Layer 2): S3 ContentType check ---
  const contentType = (headResp.ContentType || "").toLowerCase();
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

  // 2. Generate a presigned URL so FFmpeg streams the source directly from S3.
  //    This avoids downloading the file to /tmp — critical for 5 GB+ videos
  //    since all 10 GB of Lambda ephemeral storage is then free for output segments.
  //    Expiry = 3600 s (1 h) to outlast the longest possible transcode.
  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 3600 },
  );

  // 3. Create output dir
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir);

  // 3. Transcode all renditions in a single FFmpeg pass (one decode → 6 outputs).
  //    Adding more outputs to a single pass is nearly free vs. separate invocations.
  const renditions = [
    { name: "360p", scale: "640:360", bitrate: "800k" },
    { name: "480p", scale: "854:480", bitrate: "1200k" },
    { name: "720p", scale: "1280:720", bitrate: "2500k" },
    { name: "1080p", scale: "1920:1080", bitrate: "5000k" },
    { name: "2k", scale: "2560:1440", bitrate: "10000k" },
    { name: "4k", scale: "3840:2160", bitrate: "20000k" },
  ];

  // Pre-create output dirs
  for (const r of renditions) {
    fs.mkdirSync(`${outputDir}/${r.name}`);
  }

  // Build a single FFmpeg command with multiple outputs.
  // -threads 0 lets FFmpeg use all available vCPUs on the Lambda instance.
  // protocol_whitelist is required for FFmpeg to read from an HTTPS presigned URL.
  const args = [
    "-y",
    "-threads",
    "0",
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto",
    "-i",
    presignedUrl,
  ];

  for (const r of renditions) {
    const outPath = `${outputDir}/${r.name}`;
    args.push(
      "-vf",
      `scale=${r.scale}`,
      "-c:v",
      "h264",
      "-preset",
      "veryfast",
      "-b:v",
      r.bitrate,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-hls_time",
      "4",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      `${outPath}/seg_%03d.ts`,
      `${outPath}/playlist.m3u8`,
    );
  }

  console.log("Transcoding all renditions in one pass…");
  // 840 s — single pass for 6 renditions incl. 4K, leaves 60 s buffer inside Lambda timeout
  execFileSync(FFMPEG, args, { stdio: "inherit", timeout: 840_000 });

  const variants = renditions.map((r) => ({
    bandwidth: parseInt(r.bitrate) * 1000,
    resolution: r.scale.replace(":", "x"),
    uri: `${r.name}/playlist.m3u8`,
  }));

  // 4. Generate HLS master playlist
  let master = "#EXTM3U\n";
  for (const v of variants) {
    master += `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},RESOLUTION=${v.resolution}\n${v.uri}\n`;
  }
  fs.writeFileSync(`${outputDir}/master.m3u8`, master);

  // 5. Upload all generated files to processed/<assetPath>/ — in parallel
  // fs.readdirSync with { recursive: true } requires Node 18.x
  const files = fs.readdirSync(outputDir, { recursive: true });

  const uploadTasks = files
    .filter((file) => !fs.statSync(path.join(outputDir, file)).isDirectory())
    .map((file) => {
      const fullPath = path.join(outputDir, file);
      const s3Key = `processed/${assetPath}/${file}`;
      const ct = file.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : "video/MP2T";

      return s3
        .send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: s3Key,
            Body: fs.readFileSync(fullPath),
            ContentType: ct,
          }),
        )
        .then(() => console.log(`Uploaded: ${s3Key}`));
    });

  await Promise.all(uploadTasks);

  console.log(
    `Done — asset "${assetPath}" is ready at processed/${assetPath}/master.m3u8`,
  );
};
